import { test, expect, type Page } from "@playwright/test";
import { expectContained } from "./layout-assertions";

async function open(page: Page, workspace: "Trading" | "Discover") {
  await page.goto("/?demo=1");
  await page.getByRole("button", {name:"Workspace navigation", exact:true}).click();
  await page.getByRole("button", {name:workspace, exact:true}).click();
}

test("compact panes preserve unsaved inputs, keyboard access and simulation-isolated preferences", async ({page}) => {
  await page.setViewportSize({width:1280,height:900});
  await open(page,"Trading");
  await expect(page.getByRole("button",{name:/Exit presets/})).toHaveAttribute("aria-expanded","false");
  await page.getByLabel("Captured planning entry price").fill("104.25");
  await page.getByRole("button",{name:/Exit presets/}).click();
  await page.getByLabel("Preset name").fill("Unsaved preset");
  for (const selector of [".trade-count-control button", ".trade-rule-title b", ".trade-leg-name b", ".trade-preset-panel>div span", ".paper-intent-actions button", ".unlinked-positions article>div:first-child span"]) {
    expect(await page.locator(selector).first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
  }
  await page.getByRole("group",{name:"Runner count",exact:true}).getByRole("button",{name:"2",exact:true}).click();
  const runnerRow = page.locator(".trade-leg-row.runner").last();
  expect((await runnerRow.locator("label").last().boundingBox())!.x).toBeGreaterThan((await runnerRow.locator("label").first().boundingBox())!.x);
  const root = page.locator(".planner-workspace");
  const initial = await page.locator(".planner-editing-column").boundingBox();
  const positions = await page.locator(".position-command-center").boundingBox();
  expect(Math.abs(initial!.y - positions!.y)).toBeLessThan(2);
  const unrelated = page.locator(".unlinked-positions>article").first();
  expect((await unrelated.locator(":scope>small").boundingBox())!.width).toBeGreaterThan((await unrelated.boundingBox())!.width * .8);
  for (const width of [1600,1280,1024,768,390,1280]) {
    await page.setViewportSize({width,height:900});
    const compact = (await root.boundingBox())!.width < 960;
    if (compact) {
      await page.getByRole("tab",{name:"Plan",exact:true}).click();
      await page.getByRole("tab",{name:"Plan",exact:true}).press("ArrowRight");
      await expect(page.getByRole("tab",{name:/Positions/})).toBeFocused();
      await expect(page.locator(".planner-editing-column")).not.toBeVisible();
      await expect(page.getByRole("button",{name:"Open NVDA position details"})).toBeVisible();
      await page.getByRole("button",{name:"Open NVDA position details"}).click();
      await expectContained(page,".position-detail-drawer",true);
      expect(await page.locator(".position-detail-drawer i").first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
      await page.keyboard.press("Escape");
      await page.getByRole("tab",{name:"Plan",exact:true}).click();
    }
    await expect(page.getByLabel("Captured planning entry price")).toHaveValue("104.25");
    await expect(page.getByLabel("Preset name")).toHaveValue("Unsaved preset");
    if (width===390) expect((await page.getByLabel("Runner B allocation percent").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expectContained(page,".trade-ticket:not(.trade-after-fill-ticket)",true);
  }
  expect(await page.evaluate(() => localStorage.getItem("brontide.ui.v1.account.exit-presets"))).toBeNull();
  // Content breakpoint, independent of the shell width.
  for (const width of [959,960,961]) {
    await root.evaluate((el,width) => (el as HTMLElement).style.width=`${width}px`,width);
    await expect(page.getByRole("tablist",{name:"Planning and positions"}))[width<960?"toBeVisible":"toBeHidden"]();
  }
});

test("Journal distinguishes empty filters from incomplete records and expands a single record", async ({page}) => {
  await open(page,"Trading");
  await page.getByRole("button",{name:"Journal",exact:true}).click();
  await expect(page.getByRole("region",{name:"Trading statistics",exact:true}).locator(".metric-card")).toHaveCount(6);
  await expect(page.getByRole("button",{name:/More statistics/})).toHaveAttribute("aria-expanded","false");
  expect(await page.getByRole("button",{name:"Clear filters",exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
  await page.getByLabel("Find Journal symbol").fill("ZZZZ");
  await expect(page.getByText("No records match these filters",{exact:true})).toBeVisible();
  await expect(page.locator(".equity-chart")).toHaveCount(0);
  await page.getByLabel("Find Journal symbol").fill("MSFT");
  await expect(page.getByText("No eligible closed trades",{exact:true})).toBeVisible();
  await expect(page.getByText("No trades in this period.",{exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"MSFT",exact:true}).click();
  expect(await page.locator(".trade-table").evaluate(el=>el.clientHeight)).toBeGreaterThan(200);
  for (const width of [1280,1024,768,390,1280]) {
    await page.setViewportSize({width,height:900});
    await expectContained(page,".journal-content",true);
    await expectContained(page,".journal-execution-details",true);
    await expect(page.getByRole("region",{name:"MSFT entry and exit details"})).toBeVisible();
  }
  await page.getByRole("button",{name:"Clear filters",exact:true}).click();
  await expect(page.getByLabel("Find Journal symbol")).toHaveValue("");
  await expect(page.getByRole("button",{name:/More statistics/})).toHaveAttribute("aria-expanded","false");
});

test("Catalyst results precede optional analysis, preserve reports and keyboard detail", async ({page}) => {
  await open(page,"Discover");
  await page.getByRole("button",{name:"Catalysts",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Catalysts",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Premarket",exact:true}).click();
  expect(await page.locator(".catalyst-table-wrap").evaluate(el=>el.scrollHeight-el.clientHeight)).toBeLessThanOrEqual(1);
  const analysis=page.getByRole("button",{name:/Report analysis/});
  await expect(analysis).toHaveAttribute("aria-expanded","false");
  await expect(page.getByRole("button",{name:"Open NVDA catalyst detail"})).toBeVisible();
  await analysis.click();
  await expect(page.getByRole("region",{name:"Theme concentration"})).toBeVisible();
  await page.getByRole("button",{name:"Full report",exact:true}).click();
  await expect(page.locator(".catalyst-full-report pre")).toContainText("SYNTHETIC");
  await page.getByRole("button",{name:"Ticker inventory",exact:true}).click();
  for (const width of [1600,1024,390,1600]) {
    await page.setViewportSize({width,height:900});
    await expectContained(page,".catalyst-report-controls",true);
    await page.getByRole("button",{name:"Open NVDA catalyst detail"}).press("Enter");
    await expect(page.getByRole("dialog",{name:"NVDA catalyst detail"})).toBeVisible();
    await expectContained(page,".catalyst-detail",true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button",{name:"Open NVDA catalyst detail"})).toBeFocused();
  }
});

test("Catalyst empty, missing and failed delivery states keep recovery and report context visible", async ({page}) => {
  await open(page,"Discover");
  await page.getByRole("button",{name:"Catalysts",exact:true}).click();
  await page.getByRole("button",{name:"Postmarket",exact:true}).click();
  await expect(page.getByText("Published report · zero qualifying results.",{exact:true})).toBeVisible();
  await page.goto("/?demo=1&catalystFixture=missing");
  await page.getByRole("button",{name:"Weekend Summary",exact:true}).click();
  await expect(page.getByText("No Weekend Summary report received.",{exact:true})).toBeVisible();
  await page.goto("/?demo=1&catalystFixture=failure");
  await expect(page.locator(".catalyst-delivery-warning")).toBeVisible();
  await page.getByText("Delivery details and diagnostics",{exact:true}).click();
  await expect(page.getByText(/Recorded ingestion failure/)).toBeVisible();
  await expect(page.getByText(/Invalid report payload/)).toBeVisible();
});

test("200 percent CSS zoom keeps planning and Journal controls reachable", async ({page}) => {
  await page.setViewportSize({width:1280,height:1000});
  await open(page,"Trading");
  await page.addStyleTag({content:"html { zoom: 2; }"});
  await expect(page.getByRole("tab",{name:"Plan",exact:true})).toBeVisible();
  await page.getByLabel("Stock symbol").fill("LONGSYMBOL.XYZ");
  await expect(page.getByLabel("Stock symbol")).toHaveValue("LONGSYMBOL.XYZ");
  await expectContained(page,".trade-ticket:not(.trade-after-fill-ticket)",true);
  await page.getByRole("tab",{name:/Positions/}).click();
  await page.getByRole("button",{name:"Open NVDA position details"}).click();
  await expectContained(page,".position-detail-drawer",true);
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Journal",exact:true}).click();
  await expectContained(page,".journal-content",true);
  await page.getByLabel("Find Journal symbol").fill("NONE");
  await page.getByRole("button",{name:"Clear filters",exact:true}).click();
  await expect(page.getByLabel("Find Journal symbol")).toHaveValue("");
});
