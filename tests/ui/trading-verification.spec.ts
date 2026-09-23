import { test, expect } from "@playwright/test";

test("Verification opens separately, preserves the planner draft and makes no service requests", async ({ page, context }) => {
  const serviceRequests: string[] = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    // The original demo workspace loads its scanner before Trading is selected.
    // This fixture never contacts it; the separate Verification page gets no such exception.
    if (url.hostname === "127.0.0.1" && url.pathname === "/v1/scanners/biggest-one-month" && route.request().frame().page() === page) {
      return route.fulfill({ status: 503, json: { detail: "Scanner is outside this fixture" } });
    }
    if (url.hostname !== "127.0.0.1" || url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/")) {
      serviceRequests.push(`${url.hostname}${url.pathname}`);
      return route.fulfill({ status: 503, json: { detail: "No external service in this fixture" } });
    }
    return route.continue();
  });
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "Workspace navigation" }).click();
  await page.getByRole("button", { name: "Trading", exact: true }).click();
  await page.getByLabel("Stock symbol", { exact: true }).fill("DRAFTCHECK");
  await page.getByLabel("Captured planning entry price").fill("123.45");
  const link = page.getByRole("link", { name: "Verification", exact: true });
  await link.focus();
  const popupPromise = page.waitForEvent("popup");
  await link.press("Enter");
  const verification = await popupPromise;
  await expect(verification.getByRole("heading", { name: "Trading verification", exact: true })).toBeVisible();
  await expect(verification.getByRole("heading", { name: "Not approved for live trading", exact: true })).toBeVisible();
  await expect(verification.locator("[data-preview-identifier]")).toHaveAttribute("data-preview-identifier", process.env.BRONTIDE_EXPECTED_PREVIEW_ID!);
  await expect(verification.getByRole("main").locator("form,button")).toHaveCount(0);
  for (const width of [1280, 390, 1280]) {
    await verification.setViewportSize({ width, height: 900 });
    expect(await verification.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await verification.close();
  await page.bringToFront();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toHaveValue("DRAFTCHECK");
  await expect(page.getByLabel("Captured planning entry price")).toHaveValue("123.45");
  expect(serviceRequests).toEqual([]);
});

test("Verification keeps failed and historical evidence distinct from automated and unobserved results", async ({ page, context }) => {
  const serviceRequests: string[] = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" || url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/")) {
      serviceRequests.push(`${url.hostname}${url.pathname}`);
      return route.fulfill({ status: 503, json: { detail: "No external service in this fixture" } });
    }
    return route.continue();
  });
  await page.goto("/verification/");
  const failed = page.locator('[data-scenario-id="f-protection"]');
  await expect(failed).toContainText("Failed");
  await expect(failed).toContainText(/recover/i);
  await expect(page.locator('[data-scenario-id="sofi-cancel"]')).toContainText("Adds zero completed round trips.");
  await expect(page.locator('[data-scenario-id="nvda-pilot"]')).toContainText("Broker-observed");
  await expect(page.getByText("Deterministic", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Unobserved", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Blocked", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/not recorded/i).first()).toBeVisible();
  const references = await page.locator('a[href*="github.com/Melvinroy/Journal/blob/"]').evaluateAll(links => links.map(link => link.getAttribute("href")));
  expect(references.length).toBeGreaterThan(0);
  for (const reference of references) expect(reference).toMatch(/\/blob\/[0-9a-f]{40}\//);
  await page.getByRole("link", { name: "Back to workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Workspace navigation" })).toBeVisible();
  expect(serviceRequests).toEqual([]);
});
