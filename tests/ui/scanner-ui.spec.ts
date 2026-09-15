import { expect, test, type Page } from "@playwright/test";

const rows = Array.from({ length: 120 }, (_, index) => ({
  symbol: `S${String(index).padStart(3, "0")}`,
  dollar_volume: 90_000_000 + index * 1_000_000,
  growth_percent: 120 - index,
  day_percent: 60 - index,
  adr_percent: 6,
  growth_rank: 100 - index / 20,
}));

async function mockLocalScanner(page: Page, state: "current" | "stale" | "failed" = "current", fallback = false) {
  await page.route("**/v1/scanners/biggest-one-month?*", route => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ data_date: "2026-09-11", formula_version: "biggest-one-month-tc2000-v2",
      comparison_universe: { eligible: 12946, ranked: 5589, excluded: 1811,
        source: fallback ? "alpaca-fallback" : "tc2000-derived-approximate", ranking_mode: fallback ? "unknown" : "approximate", effective_rank_cutoff: fallback ? null : 89.817466 },
      status: { state, published_session: "2026-09-11", explanation: state === "current" ? null : "Test status.",
        recent_runs: [{ run_id: "run-1", mode: "due", started_at: "2026-09-12T05:45:00+08:00",
          completed_at: "2026-09-12T05:47:00+08:00", status: "succeeded", expected_session: "2026-09-11",
          retry_attempt: 0, explanation: null, diagnostics: { observed_symbols: 12548, complete_symbols: 12548,
            no_target_bar_count: 621, session_continuity_percent: 95.28, adjustment_coverage_percent: 100 } }] },
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
  await expect(page.locator(".scanner-pagebar")).toContainText("EOD 2026-09-11");
  await expect(page.getByText("Approximate ranking", { exact: true })).toBeVisible();
  await page.getByText("Update details").click();
  await expect(page.getByLabel("Recent EOD updates")).toContainText("100.00% adjustment coverage");
  await expect(page.locator(".scanner-table th")).toHaveCount(3);
  await expect(page.getByLabel("120 results")).toBeVisible();
  await expect(page.locator(".scanner-table tbody tr").first()).toContainText("S000");
  await expect(page.locator(".scanner-table tbody tr").first()).toContainText("+60.00%");
  await page.getByRole("button", { name: /^DV/ }).click();
  await expect(page.locator(".scanner-table tbody tr").first()).toContainText("S119");

  const scroller = page.getByLabel("Scanner results");
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event("scroll")); });
  await expect(page.locator(".scanner-table tbody tr").last()).toBeVisible();
  const scrollTop = await scroller.evaluate(element => element.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Biggest One Month settings" }).click();
  await page.getByLabel("Minimum dollar volume").fill("12000000");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Biggest One Month" })).toBeVisible();
  await page.getByRole("button", { name: "Biggest One Month settings" }).click();
  await expect(page.getByLabel("Minimum dollar volume")).toHaveValue("12000000");
  await page.getByRole("button", { name: "Reset defaults" }).click();
  await expect(page.getByLabel("Minimum dollar volume")).toHaveValue("89000000");
  await page.getByLabel("Minimum growth rank").press("Escape");
  await expect(page.getByRole("button", { name: "Biggest One Month settings" })).toBeFocused();

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
  await mockLocalScanner(page, "failed");
  await page.reload();
  await expect(page.getByText(/^Update failed —/)).toBeVisible();
  await expect(page.locator(".scanner-table tbody tr")).toHaveCount(120);

  await page.unroute("**/v1/scanners/biggest-one-month?*");
  await page.route("**/v1/scanners/biggest-one-month?*", route => route.abort());
  await page.getByRole("button", { name: "Biggest One Month settings" }).click();
  await page.getByLabel("Minimum ADR percent").fill("7");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText(/^Unavailable —/)).toBeVisible();
  await expect(page.locator(".scanner-table tbody tr")).toHaveCount(120);
});

test("Scanner remains contained through wide, narrow, and wide resize", async ({ page }, testInfo) => {
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
    const panel = await page.locator(".scan-panel").boundingBox();
    expect(panel).not.toBeNull();
    if (viewport.width >= 720) {
      expect(panel!.width).toBeGreaterThanOrEqual(300);
      expect(panel!.width).toBeLessThanOrEqual(360);
    }
    await expect(page.getByRole("button", { name: "Refresh EOD" })).toBeVisible();
    await page.getByRole("button", { name: "Biggest One Month settings" }).click();
    await expect(page.getByRole("button", { name: "Reset defaults" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`scanner-settings-${viewport.width}.png`) });
    await page.getByLabel("Minimum growth rank").press("Escape");
    await expect(page.getByRole("button", { name: "Biggest One Month settings" })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`scanner-${viewport.width}.png`) });
  }
});

test("Scanner discloses the prior fallback publication as approximate", async ({ page }) => {
  await mockLocalScanner(page, "failed", true);
  await openScanner(page);
  await expect(page.getByText("Approximate ranking", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Biggest One Month settings" }).click();
  await page.getByText("Formula and ranking details", { exact: true }).click();
  await expect(page.getByText(/Approximate ranking uses the prior fallback population/)).toBeVisible();
});
