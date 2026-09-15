import { test, expect, type Page } from "@playwright/test";

const empty = { connected: false, account: null, armedBatch: null, submissionsEnabled: false,
  lastReconciled: null, error: null, campaigns: [], batches: [] };
async function open(page: Page) {
  await page.goto("/?paper=1");
  await page.getByRole("button", { name: "Workspace navigation" }).click();
  await page.getByRole("button", { name: "Trading", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Paper Plan & Position" })).toBeVisible();
}

test("paper workspace is separate, locked, responsive, and never fabricates broker rows", async ({ page }, info) => {
  await page.route("**/v1/ibkr/paper/status", r => r.fulfill({ json: empty }));
  await open(page);
  await expect(page.getByText("Submissions locked", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare batch for review" })).toBeDisabled();
  for (const width of [1440, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("button", { name: "Connect paper TWS" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`paper-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Paper Journal" })).toBeVisible();
  await expect(page.locator(".paper-scroll tbody tr")).toHaveCount(0);
  await expect(page.getByText("No broker-confirmed paper campaigns.", { exact: false })).toBeVisible();
});

test("preparation errors stay visible and disconnect confirmation restores focus", async ({ page }) => {
  await page.route("**/v1/ibkr/paper/status", r => r.fulfill({ json: { ...empty, connected: true, account: "TE••ER" } }));
  await page.route("**/v1/ibkr/paper/batches", r => r.fulfill({ status: 409, json: { detail: "Short entry remains blocked: both fill bounds cannot be enforced." } }));
  await open(page);
  await page.getByLabel("Symbol", { exact: true }).fill("TEST");
  await page.getByRole("combobox", { name: "Direction", exact: true }).selectOption("Short");
  for (const label of ["Captured planning price", "Entry price cap", "Initial protective stop", "Fixed cleanup floor"])
    await page.getByLabel(label, { exact: true }).fill("100");
  await page.getByRole("button", { name: "Prepare batch for review" }).click();
  await expect(page.getByRole("region", { name: "TWS paper workspace" }).getByRole("alert")).toContainText("Short entry remains blocked");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeFocused();
});
