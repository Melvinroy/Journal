import { test, expect, type Page } from "@playwright/test";
import { expectContained } from "./layout-assertions";

async function openJournal(page: Page) {
  await page.goto('/?demo=1');
  await page.getByRole('button',{name:'Workspace navigation',exact:true}).click();
  await page.getByRole('button',{name:'Trading',exact:true}).click();
  await page.getByRole('button',{name:'Journal',exact:true}).click();
}

test('Journal restores panels and fills actual plot bounds across responsive sizes', async ({page}) => {
  await openJournal(page);
  for (const width of [1600,1280,1024,768,390,1600]) {
    await page.setViewportSize({width,height:900});
    const journal = page.locator('.journal-content');
    const contentWidth = await journal.evaluate(el=>el.clientWidth-parseFloat(getComputedStyle(el).paddingLeft)-parseFloat(getComputedStyle(el).paddingRight));
    const equity = await page.locator('.equity-panel').boundingBox();
    const distribution = await page.locator('.distribution-panel').boundingBox();
    if(contentWidth>=960) expect(Math.abs(equity!.y-distribution!.y)).toBeLessThan(2);
    else expect(distribution!.y).toBeGreaterThan(equity!.y+equity!.height);
    const setup = await page.locator('.setup-panel').boundingBox();
    const trades = await page.locator('.trades-panel').boundingBox();
    expect(setup!.y).toBeGreaterThan(distribution!.y);
    expect(trades!.y).toBeGreaterThan(setup!.y+setup!.height);
    for(const selector of ['.equity-chart','.distribution-chart']) {
      await expect.poll(()=>page.locator(`${selector} svg`).evaluate(el=>Math.abs(el.getBoundingClientRect().width-(el as SVGSVGElement).viewBox.baseVal.width))).toBeLessThan(1);
      const plot=await page.locator(selector).evaluate(el=>{
        const svg=el.querySelector('svg')!.getBoundingClientRect();
        const line=el.querySelector('.chart-grid')!.getBoundingClientRect();
        return {left:line.left-svg.left,right:svg.right-line.right,height:svg.height};
      });
      expect(plot.left).toBeLessThanOrEqual(65);
      expect(plot.right).toBeLessThanOrEqual(19);
      expect(plot.height).toBe(width<640?220:260);
      await expectContained(page,selector,true);
    }
  }
  for(const width of [959,960,961]) {
    await page.locator('.journal-content').evaluate((el,width)=>{(el as HTMLElement).style.width=`${width}px`; (el as HTMLElement).style.padding='0';},width);
    await expect.poll(()=>page.locator('.analytics-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(width<960?1:2);
  }
});

test('Journal uses compact aligned rows, sticky symbols and complete expandable metadata', async ({page})=>{
  await page.setViewportSize({width:1600,height:900});
  await openJournal(page);
  const table=page.locator('.trade-table');
  const row=page.locator('.trade-row:not(.table-head)').first();
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(40);
  await expect(row.locator('.symbol-cell')).toHaveText('NVDA');
  await expect(row.locator('.journal-setup-source')).toContainText('Momentum breakout · Legacy');
  const geometry=await row.evaluate(el=>{
    const cells=[...el.children].map(e=>e.getBoundingClientRect());
    return {gap:cells[2].left-cells[1].right, tops:cells.map(c=>c.top)};
  });
  expect(geometry.gap).toBeGreaterThanOrEqual(8);
  expect(geometry.gap).toBeLessThanOrEqual(12);
  await page.setViewportSize({width:390,height:844});
  await expectContained(page,'.trade-table',true);
  await table.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  const symbol=await row.locator('.symbol-cell').boundingBox();
  expect(Math.abs(symbol!.x-(await table.boundingBox())!.x)).toBeLessThan(2);
  await row.getByRole('button',{name:'NVDA',exact:true}).click();
  await expectContained(page,'.journal-execution-details',true);
  await expect(page.getByRole('region',{name:'NVDA entry and exit details'})).toContainText('Momentum breakout · Legacy');
  await expect(page.getByLabel('NVDA One lesson')).toBeVisible();
});

test('Journal view and unit controls preserve results and explain optional measurements',async({page})=>{
  await openJournal(page);
  await expect(page.locator('.equity-panel .chart-summary strong')).toHaveText('+$6,099');
  await page.getByLabel('Equity chart view',{exact:true}).selectOption('drawdown');
  await expect(page.getByLabel('Equity chart unit',{exact:true})).toHaveCount(0);
  await expect(page.locator('.equity-panel .chart-summary strong')).toHaveText('−$310');
  await expect(page.locator('.journal-chart-explanation')).toContainText('Decline');
  await page.getByLabel('Equity chart view',{exact:true}).selectOption('equity');
  await page.getByLabel('Equity chart unit',{exact:true}).selectOption('r');
  await expect(page.locator('.journal-chart-explanation')).toContainText('1R');
  await expect(page.locator('.equity-panel .chart-summary strong')).toContainText('R');
  await page.getByLabel('Find Journal symbol').fill('MSFT');
  await expect(page.getByText('No eligible closed trades',{exact:true})).toBeVisible();
  await expect(page.locator('.equity-chart')).toHaveCount(0);
  await expect(page.locator('.trade-row:not(.table-head)')).toHaveCount(1);
  await page.getByLabel('Find Journal symbol').fill('NOT_FOUND');
  await expect(page.getByText('No records match these filters',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await page.addStyleTag({content:'html {zoom:2}'});
  await expectContained(page,'.journal-content',true);
  await expectContained(page,'.journal-chart-controls',true);
});

test('Long symbols and large negative values remain complete in compact rows',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await openJournal(page);
  await page.getByRole('button',{name:'Log trade',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Log a trade'});
  await dialog.getByLabel('Symbol',{exact:true}).fill('LONGSYMBOL.XYZ');
  await dialog.getByLabel('Dollar risk').fill('999999999');
  await dialog.getByLabel('Planned reward').fill('5');
  await dialog.getByLabel('Final P&L').fill('-987654321');
  await dialog.getByRole('button',{name:'Save trade',exact:true}).click();
  const row=page.locator('.trade-row:not(.table-head)').filter({hasText:'LONGSYMBOL.XYZ'});
  await expect(row).toContainText('−$987,654,321');
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(40);
  const clipped=await row.locator(':scope>span:not(.journal-setup-source)').evaluateAll(els=>els.filter(el=>el.scrollWidth>el.clientWidth+1).length);
  expect(clipped).toBe(0);
  expect(await page.locator('.equity-chart svg').evaluate(el=>{
    const bounds=el.getBoundingClientRect();
    return [...el.querySelectorAll('.axis-label')].some(label=>{const r=label.getBoundingClientRect();return r.left<bounds.left-1 || r.right>bounds.right+1;});
  })).toBe(false);
  await page.setViewportSize({width:390,height:844});
  await expectContained(page,'.trade-table',true);
  await row.getByRole('button').click();
  await expectContained(page,'.journal-execution-details',true);
});
