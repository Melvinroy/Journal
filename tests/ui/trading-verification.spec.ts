import { test, expect, type BrowserContext, type Page } from "@playwright/test";

async function interceptServices(context: BrowserContext, workspace: Page) {
  const unexpected: string[] = [];
  const workspaceReads: string[] = [];
  await context.route("**/*", route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === "127.0.0.1" && !url.pathname.startsWith("/v1/") && !url.pathname.startsWith("/api/")) {
      return route.continue();
    }
    const frame = request.frame();
    const document = new URL(frame.url());
    const expectedRead = request.method() === "GET" && (
      url.hostname === "127.0.0.1" && ["/v1/scanners/biggest-one-month", "/v1/chart/NVDA"].includes(url.pathname)
      || url.hostname === "brontide-test.supabase.co" && url.pathname === "/rest/v1/catalyst_reports"
    );
    // Only these intercepted reads belong to the original workspace document.
    // Verification (including its popup) gets no service-request exception.
    if (frame.page() === workspace && document.pathname === "/" && expectedRead) {
      workspaceReads.push(`${url.hostname}${url.pathname}`);
    } else {
      unexpected.push(`${url.hostname}${url.pathname}`);
    }
    return route.fulfill({ status: 503, json: { detail: "No external service in this fixture" } });
  });
  return { unexpected, workspaceReads };
}

test("Verification opens separately, preserves the planner draft and makes no service requests", async ({ page, context }) => {
  const { unexpected: serviceRequests } = await interceptServices(context, page);
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
  const { unexpected: serviceRequests } = await interceptServices(context, page);
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
  expect(serviceRequests).toEqual([]);
  await page.getByRole("link", { name: "Back to workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Workspace navigation" })).toBeVisible();
  expect(serviceRequests).toEqual([]);
});

test("Verification request guard detects even workspace-shaped reads from the evidence document", async ({ page, context }) => {
  const { unexpected, workspaceReads } = await interceptServices(context, page);
  await page.goto("/verification/");
  await expect(page.getByRole("heading", { name: "Trading verification", exact: true })).toBeVisible();
  expect(unexpected).toEqual([]);
  // Controlled fault injection: same URL allowed for workspace, forbidden here.
  await page.evaluate(() => fetch("/v1/scanners/biggest-one-month"));
  expect(unexpected).toEqual(["127.0.0.1/v1/scanners/biggest-one-month"]);
  expect(workspaceReads).toEqual([]);
});
