import {test,expect,type Page} from '@playwright/test';
import fs from 'node:fs';
async function authenticate(page:Page){
 await page.addInitScript(()=>localStorage.setItem('sb-catalyst-fixture-auth-token',JSON.stringify({access_token:'fixture-access-token',refresh_token:'fixture-refresh-token',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:'00000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated',email:'owner@example.test',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-09-10T00:00:00Z'}})));
}
async function open(page:Page,query='?demo=1'){
 await page.goto('/'+query);
 const menu=page.getByRole('button',{name:'Workspace navigation',exact:true});
 await expect(menu.or(page.getByRole('button',{name:'Discover',exact:true})).first()).toBeVisible();
 if(await menu.isVisible())await menu.click();
 await page.getByRole('button',{name:'Discover',exact:true}).click();
 await page.getByRole('button',{name:'Catalysts',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Catalysts',exact:true})).toBeVisible();
}
async function expectSignalCardGeometry(page:Page){
 const geometry=await page.locator('.catalyst-signal-card').evaluateAll(cards=>cards.map(card=>{
   const box=card.getBoundingClientRect(),main=card.querySelector('.catalyst-signal-main')!.getBoundingClientRect();
   const ticker=card.querySelector('.catalyst-signal-line strong')!.getBoundingClientRect(),badge=card.querySelector('.catalyst-grade')!.getBoundingClientRect();
   const overlaps=!(ticker.right<=badge.left||badge.right<=ticker.left||ticker.bottom<=badge.top||badge.bottom<=ticker.top);
   return {cardWidth:box.width,mainWidth:main.width,overlaps};
 }));
 expect(geometry.length).toBeGreaterThan(0);
 for(const card of geometry){expect(card.mainWidth/card.cardWidth).toBeGreaterThan(.85);expect(card.overlaps).toBe(false);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
}
test('three types, scoped history, empty results, navigation, keyboard details and responsive layout',async({page})=>{
 await open(page);
 await expect(page.getByRole('button',{name:'Weekend Summary',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('button',{name:'Open WEEK catalyst detail'})).toBeVisible();
 await page.getByRole('button',{name:'Premarket',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open WEEK catalyst detail'})).toHaveCount(0);
 await page.getByRole('button',{name:/Report analysis/}).click();
 const leadership=page.locator('.catalyst-leader-panel');
 await expect(leadership.nth(0).locator('.catalyst-signal-card')).toHaveCount(6);
 await expect(leadership.nth(1).locator('.catalyst-signal-card')).toHaveCount(5);
 await expect(leadership.nth(0).locator('.catalyst-count')).toHaveText('6');
 await expect(leadership.nth(1).locator('.catalyst-count')).toHaveText('5');
 await page.getByLabel('Report history').selectOption('sample-old');
 await expect(page.getByText(/Older report being shown/)).toBeVisible();
 await page.getByRole('navigation',{name:'Discover views'}).getByRole('button',{name:'Scans',exact:true}).click();
 await page.getByRole('button',{name:'Catalysts',exact:true}).click();
 await expect(page.getByLabel('Report history')).toHaveValue('sample-old');
 await page.reload();
 await expect(page.getByLabel('Report history')).toHaveValue('sample-old');
 await page.getByLabel('Report history').selectOption('');
 await expect(page.getByRole('region',{name:'Theme concentration'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Bullish themes'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Bearish themes'})).toBeVisible();
 await page.getByRole('group',{name:'Theme range'}).getByRole('button',{name:'3D',exact:true}).click();
 await expect(page.getByRole('group',{name:'Theme range'}).getByRole('button',{name:'3D',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('group',{name:'Theme range'}).getByRole('button',{name:'Selected report',exact:true}).click();
 await page.getByRole('button',{name:'Full report',exact:true}).click();
 await expect(page.locator('.catalyst-full-report pre')).toContainText('SYNTHETIC PREMARKET REPORT');
 await page.getByRole('button',{name:'Ticker inventory',exact:true}).click();
 await page.locator('.catalyst-signal-card').first().locator('strong').evaluate(node=>{node.textContent='LONGTICKER';});
 await expectSignalCardGeometry(page);
 await expect(page.locator('.catalyst-signal-card').first()).not.toContainText('Move');
 await expect(page.locator('.catalyst-signal-card').first()).not.toContainText('Freshness');
 await expect(page.locator('.catalyst-signal-card').first()).not.toContainText('Confidence');
 expect(await page.locator('.catalyst-leadership-grid').evaluate(grid=>getComputedStyle(grid).gridTemplateColumns.split(' ').length)).toBe(2);
 for(const panel of [leadership.nth(0),leadership.nth(1)]){
   const stack=panel.locator('.catalyst-signal-stack'),last=stack.locator('.catalyst-signal-card').last();
   await expect(stack).toHaveCSS('overflow-y','visible');
   await last.focus();
   await expect(last).toBeInViewport();
 }
 await expect(page.locator('.catalyst-signal-card').first().locator('.catalyst-signal-summary')).toHaveCSS('white-space','normal');
 await page.setViewportSize({width:980,height:800});
 await expectSignalCardGeometry(page);
 await page.setViewportSize({width:1440,height:900});
 await page.screenshot({path:'output/playwright/catalysts/refined-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Open NVDA catalyst detail'}).press('Enter');
 await expect(page.getByRole('button',{name:'Close catalyst detail'})).toBeFocused();
 await page.keyboard.press('Shift+Tab');
 await expect(page.getByRole('button',{name:'Open chart at report session'})).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'Open NVDA catalyst detail'})).toBeFocused();
 await page.setViewportSize({width:390,height:844});
 for(const panel of [leadership.nth(0),leadership.nth(1)]){
   const stack=panel.locator('.catalyst-signal-stack');
   await stack.locator('.catalyst-signal-card').last().focus();
   await expect(stack.locator('.catalyst-signal-card').last()).toBeInViewport();
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole('button',{name:'Postmarket',exact:true}).click();
 await expect(page.getByText('Published report · zero qualifying results.')).toBeVisible();
 await page.screenshot({path:'output/playwright/catalysts/desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Weekend Summary',exact:true}).click();
 await expectSignalCardGeometry(page);
 await page.screenshot({path:'output/playwright/catalysts/mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:1440,height:900});
 await expect(page.getByRole('button',{name:'Weekend Summary',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.evaluate(()=>sessionStorage.clear());
 await page.reload();
 await expect(page.getByRole('button',{name:'Weekend Summary',exact:true})).toHaveAttribute('aria-pressed','true');
});
test('demo exit exposes the existing sign-in flow without using fixture data',async({page})=>{
 await page.goto('/?demo=1');
 await expect(page.getByText('Demo data',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Leave demo and sign in'}).click();
 await expect(page).not.toHaveURL(/demo=1/);
 if(!await page.getByRole('heading',{name:'Welcome back'}).isVisible()) {
   await page.getByRole('button',{name:'Workspace navigation',exact:true}).click();
   await page.getByRole('button',{name:'Trading',exact:true}).click();
 }
 await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();
 await expect(page.getByText(/Fictional reports/)).toHaveCount(0);
});
test('password recovery turns an unreachable auth service into a retryable error',async({page})=>{
 await page.route('**/auth/v1/recover*',route=>route.abort());
 await page.goto('/?paper=1');
 await page.getByRole('button',{name:'Forgot password?'}).click();
 await page.getByLabel('Email address').fill('reader@example.com');
 await page.getByRole('button',{name:'Send reset link'}).click();
 await expect(page.locator('.auth-message[role="alert"]')).toHaveText('Unable to reach the authentication service. Check your connection and try again.');
 await expect(page.getByRole('button',{name:'Send reset link'})).toBeEnabled();
});
test('failed ticker retrieval keeps report text and marks every metric unavailable',async({page})=>{
 test.skip(!process.env.CATALYST_LIVE_FIXTURE,'Optional private read-only snapshot; never checked in');
 const fixture=JSON.parse(fs.readFileSync(process.env.CATALYST_LIVE_FIXTURE!,'utf8'));
 await page.route('https://catalyst-fixture.supabase.co/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/catalyst_dashboard_rows'))return route.abort();
   let body:unknown=[];
   if(url.pathname.endsWith('/catalyst_reports')){const id=url.searchParams.get('id')?.replace('eq.','');body=id?fixture.reports.find((r:{id:string})=>r.id===id)??null:fixture.reports;}
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await authenticate(page);
 await open(page,'');
 await expect(page.locator('.catalyst-kpi strong')).toHaveText(['—','—','—','—','—']);
 await expect(page.getByRole('heading',{name:'Report commentary is still available'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Retry results'})).toBeEnabled();
 await page.getByRole('button',{name:'Full report'}).click();
 await expect(page.locator('.catalyst-full-report pre')).not.toBeEmpty();
});
test('missing type, late receipt and known ingestion failure do not invent scheduler failure',async({page})=>{
 await open(page,'?demo=1&catalystFixture=missing');
 await page.getByRole('button',{name:'Weekend Summary',exact:true}).click();
 await expect(page.getByText('No Weekend Summary report received.',{exact:true})).toBeVisible();
 await expect(page.locator('.catalyst-table tbody tr')).toHaveCount(0);
 await open(page,'?demo=1&catalystFixture=failure');
 await page.getByText('Delivery details and diagnostics',{exact:true}).click();
 await expect(page.locator('.catalyst-delivery-grid').getByText('Late · expected report not yet received')).toBeVisible();
 await expect(page.getByText(/Scheduler: succeeded/)).toBeVisible();
 await expect(page.getByText(/Recorded ingestion failure/)).toBeVisible();
 await expect(page.getByText(/Invalid report payload/)).toBeVisible();
 await page.screenshot({path:'output/playwright/catalysts/failure.png',fullPage:true});
});
test('stored Supabase payload replay uses the real report IDs and Table 3 rows',async({page})=>{
 test.skip(!process.env.CATALYST_LIVE_FIXTURE,'Optional private read-only snapshot; never checked in');
 const fixture=JSON.parse(fs.readFileSync(process.env.CATALYST_LIVE_FIXTURE!,'utf8'));
 await page.route('https://catalyst-fixture.supabase.co/**',async route=>{
   const url=new URL(route.request().url());let body:unknown=[];
   if(url.pathname.endsWith('/catalyst_reports')){const id=url.searchParams.get('id')?.replace('eq.','');body=id?fixture.reports.find((r:{id:string})=>r.id===id)??null:fixture.reports;}
   if(url.pathname.endsWith('/catalyst_dashboard_rows')){const id=url.searchParams.get('report_id')?.replace('eq.','');body=fixture.rows.filter((r:{report_id:string})=>r.report_id===id);}
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await authenticate(page);
 await open(page,'');
 for(const [label,id,count] of [['Premarket','6cb70eeb-2f5c-49c2-8751-26051a48aa33',23],['Postmarket','22e3316c-cf1a-4e53-8baf-038880385d82',28],['Weekend Summary','42525273-7f22-4a40-9dab-66587be11b17',20]] as const){
   await page.getByRole('button',{name:label,exact:true}).click();
   await expect(page.locator('.catalyst-table tbody tr')).toHaveCount(count);
   await page.getByText('Delivery details and diagnostics',{exact:true}).click();
   await expect(page.getByText(new RegExp(`Report ID: ${id}`))).toBeVisible();
   await page.getByText('Delivery details and diagnostics',{exact:true}).click();
 }
 await page.getByRole('button',{name:'Premarket',exact:true}).click();
 await page.getByLabel('Report history').selectOption('a815d750-74ea-481b-8446-32a3aed9e4c9');
 await expect(page.getByText('No inventory rows received. Legacy report completeness is not recorded.')).toBeVisible();
 await page.getByRole('button',{name:'Weekend Summary',exact:true}).click();
 await page.screenshot({path:'output/playwright/catalysts/stored-weekend-replay.png',fullPage:true});
});
test('isolated PostgreSQL ingestion output reaches the dashboard after duplicate, correction and rejection checks',async({page})=>{
 test.skip(!process.env.CATALYST_INGESTED_FIXTURE,'Run local PostgreSQL fixture test first');
 const fixture=JSON.parse(fs.readFileSync(process.env.CATALYST_INGESTED_FIXTURE!,'utf8'));
 await page.route('https://catalyst-fixture.supabase.co/**',async route=>{
   const url=new URL(route.request().url());let body:unknown=[];
   if(url.pathname.endsWith('/catalyst_reports')){const id=url.searchParams.get('id')?.replace('eq.','');body=id?fixture.reports.find((r:{id:string})=>r.id===id)??null:fixture.reports;}
   if(url.pathname.endsWith('/catalyst_dashboard_rows'))body=fixture.rows.filter((r:{report_id:string})=>r.report_id===url.searchParams.get('report_id')?.replace('eq.',''));
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await authenticate(page);
 await open(page,'');
 for(const [type,count] of [['Premarket',1],['Postmarket',0],['Weekend Summary',1]] as const){
   await page.getByRole('button',{name:type,exact:true}).click();
   await expect(page.locator('.catalyst-table tbody tr')).toHaveCount(count);
    if(type==='Premarket'){
      await page.getByRole('button',{name:'Open FIX catalyst detail'}).click();
      await expect(page.getByRole('dialog',{name:'FIX catalyst detail'}).getByText('Corrected fixture',{exact:true})).toBeVisible();
      await page.keyboard.press('Escape');
    }
   if(type==='Postmarket')await expect(page.getByText('Published report · zero qualifying results.')).toBeVisible();
 }
});
