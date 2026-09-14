import { expect, test, type Page } from "@playwright/test";

const rows = Array.from({ length: 120 }, (_, index) => ({
  symbol: `S${String(index).padStart(3, "0")}`,
  dollar_volume: 10_000_000 + index * 1_000_000,
  growth_percent: 120 - index,
  adr_percent: 6,
  growth_rank: 100 - index / 20,
}));

async function mockLocalScanner(page: Page, state: "current" | "stale" | "failed" = "current") {
  await page.route("**/v1/scanners/biggest-one-month?*", route => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ data_date: "2026-09-11", formula_version: "biggest-one-month-v1",
      comparison_universe: { eligible: 13154, ranked: 12236, excluded: 918 },
      status: { state, published_session: "2026-09-11", explanation: state === "current" ? null : "Test status." },
      results: rows }),
  }));
  await page.route("**/v1/eod/refresh", route => route.fulfill({ status: 202, contentType: "application/json",
    body: JSON.stringify({ state: "queued", run_id: "test-run" }) }));
  await page.route("**/v1/eod/status", route => route.fulfill({ contentType: "application/json",
    body: JSON.stringify({ state: "current", published_session: "2026-09-11" }) }));
  await page.route("**/v1/chart/*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    schema_version: 1, instrument: { symbol: "S000", name: "Scanner row", exchange: "NASDAQ", status: "active" },
    bars: [], series: { source: "alpaca_sip", adjustment: "all", timeframe: "1Day", limit: 1250, returned: 0 },
    status: { freshness: "fresh", last_session: "2026-09-11", expected_session: "2026-09-11", calendar_covered: true },
  }) }));
}

async function openScanner(page: Page) {
  await page.goto("/?demo=1");
  const menu = page.getByRole("button", { name: "Workspace navigation" });
  await expect(menu).toBeVisible();
  await menu.click();
  await page.getByRole("button", { name: "Discover", exact: true }).click();
  await page.getByRole("navigation", { name: "Discover views" }).getByRole("button", { name: "Scanner", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Biggest One Month" })).toBeVisible();
}

test("Scanner preserves the three-column contract, sorting, settings, full scrolling, and chart return", async ({ page }) => {
  await mockLocalScanner(page);
  await openScanner(page);
  await expect(page.locator(".scanner-table th")).toHaveCount(3);
  await expect(page.getByLabel("120 results")).toBeVisible();
  await expect(page.locator(".scanner-table tbody tr").first()).toContainText("S000");
  await page.getByRole("button", { name: /Dollar volume/ }).click();
  await expect(page.locator(".scanner-table tbody tr").first()).toContainText("S119");

  const scroller = page.getByLabel("Scanner results");
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event("scroll")); });
  await expect(page.locator(".scanner-table tbody tr").last()).toBeVisible();
  const scrollTop = await scroller.evaluate(element => element.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Minimum dollar volume").fill("12000000");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Biggest One Month" })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Minimum dollar volume")).toHaveValue("12000000");
  await page.getByRole("button", { name: "Reset defaults" }).click();
  await expect(page.getByLabel("Minimum dollar volume")).toHaveValue("9000000");

  await page.locator(".scanner-table tbody tr").first().focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Workspace navigation" }).click();
  await expect(page.getByRole("button", { name: "Back to workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Back to workspace" }).click();
  await expect(page.getByRole("heading", { name: "Biggest One Month" })).toBeVisible();
});

test("Scanner exposes stale, failed-last-valid, manual refresh, and unavailable states", async ({ page }) => {
  await mockLocalScanner(page, "stale");
  await openScanner(page);
  await expect(page.getByText(/^Stale —/)).toBeVisible();
  await page.getByRole("button", { name: "Refresh EOD" }).click();
  await expect(page.getByText(/Updating — showing the last validated results/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh EOD" })).toBeEnabled({ timeout: 8_000 });

  await page.unroute("**/v1/scanners/biggest-one-month?*");
  await page.route("**/v1/scanners/biggest-one-month?*", route => route.abort());
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Minimum ADR percent").fill("7");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText(/^Unavailable —/)).toBeVisible();
  await expect(page.locator(".scanner-table tbody tr")).toHaveCount(120);
});

test("Scanner remains contained through wide, narrow, and wide resize", async ({ page }) => {
  await mockLocalScanner(page, "failed");
  await openScanner(page);
  await expect(page.getByText(/^Update failed — showing 2026-09-11/)).toBeVisible();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const box = await page.locator(".scanner-table-wrap").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  }
});
