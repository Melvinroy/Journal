import { expect, type Locator, type Page } from "@playwright/test";

export type Geometry = { x: number; y: number; width: number; height: number; right: number; bottom: number };

export async function geometry(locator: Locator): Promise<Geometry> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  });
}

export function expectGeometryWithin(actual: Geometry, expected: Geometry, tolerance = 1) {
  for (const key of ["x", "y", "width", "height", "right", "bottom"] as const) {
    expect(Math.abs(actual[key] - expected[key]), `${key}: expected ${expected[key]}, received ${actual[key]}`).toBeLessThanOrEqual(tolerance);
  }
}

export async function clippingReport(page: Page, selector: string) {
  return page.locator(selector).evaluate((element, targetSelector) => {
    const rect = element.getBoundingClientRect();
    const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const clips: Array<{ selector: string; rect: { left: number; top: number; right: number; bottom: number }; overflowX: string; overflowY: string }> = [];
    let ancestor = element.parentElement;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if ([style.overflowX, style.overflowY].some(value => value !== "visible")) {
        const ancestorRect = ancestor.getBoundingClientRect();
        clips.push({
          selector: ancestor.className ? `.${String(ancestor.className).trim().replace(/\s+/g, ".")}` : ancestor.tagName.toLowerCase(),
          rect: { left: ancestorRect.left, top: ancestorRect.top, right: ancestorRect.right, bottom: ancestorRect.bottom },
          overflowX: style.overflowX,
          overflowY: style.overflowY,
        });
      }
      ancestor = ancestor.parentElement;
    }
    const bounds = [viewport, ...clips.map(clip => clip.rect)];
    return {
      selector: targetSelector,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      viewport,
      clips,
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      horizontallyContained: bounds.every(bound => rect.left >= bound.left - 1 && rect.right <= bound.right + 1),
      contained: bounds.every(bound => rect.left >= bound.left - 1 && rect.right <= bound.right + 1 && rect.top >= bound.top - 1 && rect.bottom <= bound.bottom + 1),
    };
  }, selector);
}

export async function expectContained(page: Page, selector: string, horizontalOnly = false) {
  const report = await clippingReport(page, selector);
  expect(horizontalOnly ? report.horizontallyContained : report.contained, JSON.stringify(report, null, 2)).toBe(true);
  return report;
}

export async function expectContainedScroller(page: Page, selector: string) {
  const report = await expectContained(page, selector, true);
  const scrolling = await page.locator(selector).evaluate(element => ({
    clientWidth: element.clientWidth,
    overflowX: getComputedStyle(element).overflowX,
    scrollWidth: element.scrollWidth,
  }));
  expect(["auto", "scroll"], `${selector} must own its intentional horizontal scrolling`).toContain(scrolling.overflowX);
  expect(scrolling.scrollWidth).toBeGreaterThan(scrolling.clientWidth);
  return report;
}
