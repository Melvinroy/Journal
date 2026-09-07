import { expect, test, type Page } from "@playwright/test";

type Theme = "light" | "dark";

async function openDeterministicChart(page: Page, theme: Theme) {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/charts/");
  await expect(page.getByRole("application", { name: /NVDA interactive price chart/ })).toBeVisible();
  await expect.poll(() => page.locator(".market-chart canvas").count()).toBeGreaterThan(0);
  if (theme === "dark") {
    await page.getByRole("button", { name: "More chart options" }).click();
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await page.keyboard.press("Escape");
  }
  await expect(page.locator(".chart-layout-v1")).toHaveClass(new RegExp(`theme-${theme}`));
  await page.mouse.move(640, 24);
  await page.waitForTimeout(250);
}

for (const theme of ["light", "dark"] as const) {
  test(`active tool and chevron remain contained and independently usable — ${theme}`, async ({ page }) => {
    await openDeterministicChart(page, theme);
    const rail = page.getByRole("complementary", { name: "Drawing tools" });
    const tool = page.getByRole("button", { name: /^Trend Line · Lines/ }).first();
    const opener = page.getByRole("button", { name: "Open Lines tools" });

    await tool.click();
    await expect(tool).toHaveClass(/active/);
    await expect(page.locator(".drawing-hint")).toContainText("Place trend line anchors");

    const geometry = await page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>(".drawing-rail")!.getBoundingClientRect();
      const tool = document.querySelector<HTMLElement>('.drawing-group-slot > button[aria-label^="Trend Line"]')!;
      const opener = document.querySelector<HTMLElement>('.drawing-group-open[aria-label="Open Lines tools"]')!;
      const toolBox = tool.getBoundingClientRect();
      const openerBox = opener.getBoundingClientRect();
      const toolHit = document.elementFromPoint(toolBox.left + toolBox.width / 2, toolBox.top + toolBox.height / 2);
      const openerHit = document.elementFromPoint(openerBox.left + openerBox.width / 2, openerBox.top + openerBox.height / 2);
      return {
        contained: openerBox.left >= rail.left && openerBox.right <= rail.right && openerBox.top >= rail.top && openerBox.bottom <= rail.bottom,
        toolCenterHitsTool: tool.contains(toolHit),
        openerCenterHitsOpener: opener.contains(openerHit),
        distinctCenters: toolBox.left + toolBox.width / 2 !== openerBox.left + openerBox.width / 2,
      };
    });
    expect(geometry).toEqual({ contained: true, toolCenterHitsTool: true, openerCenterHitsOpener: true, distinctCenters: true });

    await expect(page).toHaveScreenshot(`toolbar-${theme}.png`, { clip: { x: 0, y: 48, width: 48, height: 280 } });
    await opener.click();
    await expect(opener).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("region", { name: "Lines drawing tools" })).toBeVisible();
    await expect(tool).toHaveClass(/active/);
    await expect(rail).toBeVisible();
  });

  test(`volume is bar-only while price moving averages remain available — ${theme}`, async ({ page }) => {
    await openDeterministicChart(page, theme);
    const legend = page.locator(".chart-legend");
    await expect(legend).toContainText("MA20:");
    await expect(legend).toContainText("MA50:");
    await expect(legend).toContainText("MA200:");

    await page.getByRole("button", { name: "Studies" }).click();
    const ma20 = page.getByRole("checkbox", { name: "20 SMA" });
    const ma50 = page.getByRole("checkbox", { name: "50 SMA" });
    const ma200 = page.getByRole("checkbox", { name: "200 SMA" });
    await expect(ma20).toBeChecked();
    await expect(ma50).toBeChecked();
    await expect(ma200).toBeChecked();
    await ma20.uncheck();
    await expect(legend).not.toContainText("MA20:");
    await ma20.check();
    await expect(legend).toContainText("MA20:");
    await page.keyboard.press("Escape");
    await page.mouse.move(640, 24);
    await page.waitForTimeout(250);

    const chart = await page.locator(".chart-canvas-shell").boundingBox();
    expect(chart).not.toBeNull();
    await expect(page).toHaveScreenshot(`price-and-volume-${theme}.png`, { clip: chart! });
  });
}
