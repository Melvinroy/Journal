import { test, expect, type Page } from "@playwright/test";
const empty = { connected: true, connectionId: "connection-1", account: "DU••10", armedBatch: null, submissionsEnabled: false,
  lastReconciled: new Date().toISOString(), error: null, campaigns: [], batches: [], broker: null,
  readiness: { state: "blocked", message: "Connected; server paper submissions are locked." } };
async function navigate(page: Page) {
  await page.goto("/?paper=1");
  await expect(page.getByLabel("Email address")).toBeVisible();
}
async function signIn(page: Page, status: Record<string, unknown> = empty) {
  await page.route("https://brontide-test.supabase.co/**", r => r.fulfill({ json: r.request().url().includes("/token") ? {
    access_token: "test-access-token", refresh_token: "test-refresh-token", expires_in: 3600, token_type: "bearer",
    user: { id: "00000000-0000-0000-0000-000000000001", email: "test@example.com", email_confirmed_at: new Date().toISOString(), aud: "authenticated" }
  } : [] }));
  await page.route("**/v1/ibkr/paper/identity", r => r.fulfill({ json: { userId: "test-user", email: "test@example.com", linked: true } }));
  await page.route("**/v1/ibkr/paper/status", r => r.fulfill({ json: status }));
  await navigate(page);
  await page.getByLabel("Email address").fill("test@example.com");
  await page.getByLabel("Password", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trade planner", exact: true })).toBeVisible();
}

test("paper compatibility link requires sign-in and opens the existing planner", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Paper Plan & Position" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Open.*demo|separate/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review paper order" })).toBeDisabled();
  for (const width of [1440, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const status = page.getByLabel("TWS connection: Paper connection blocked");
    await status.focus(); await status.press("Enter");
    await expect(page.getByText(empty.readiness.message, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await status.press("Enter");
  }
});

test("draft saving never submits; exact review errors remain in the planner", async ({ page }) => {
  let writes = 0;
  await page.route("**/v1/ibkr/paper/submit", r => { writes++; return r.fulfill({ json: {} }); });
  await page.route("**/v1/ibkr/paper/batches", r => r.fulfill({ status: 409, json: { detail: "Executable quotes unavailable (IBKR 10197)." } }));
  await signIn(page);
  await page.getByLabel("Stock symbol").fill("TEST");
  await page.getByLabel("Captured planning entry price").fill("100");
  await page.getByLabel("Stop method").selectOption("Manual");
  await page.getByLabel("Stop price", { exact: true }).fill("98");
  await page.getByLabel("Requested shares").fill("3");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page.getByRole("button", { name: "Save exits", exact: true }).click();
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "Review paper order" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "10197" })).toBeVisible();
  expect(writes).toBe(0);
});

async function savePlan(page: Page) {
  await page.getByLabel("Stock symbol").fill("TEST");
  await page.getByLabel("Captured planning entry price").fill("100");
  await page.getByLabel("Stop method").selectOption("Manual");
  await page.getByLabel("Stop price", { exact: true }).fill("98");
  await page.getByLabel("Requested shares").fill("3");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page.getByRole("button", { name: "Save exits", exact: true }).click();
}
async function mockReview(page: Page) {
  await page.route("**/v1/ibkr/paper/batches", async r => {
    const { tickets } = r.request().postDataJSON();
    await r.fulfill({ json: { id: "batch", digest: "a".repeat(64), tickets, sourceIdentity: "test-source", validUntil: new Date(Date.now()+60000).toISOString() } });
  });
}

test("exact confirmation, keyboard dismissal, and double-click submit guard", async ({ page }) => {
  let approvals = 0, submissions = 0;
  await page.route("**/v1/ibkr/paper/batches/batch/approve", async r => { approvals++; await r.fulfill({ json: {} }); });
  await page.route("**/v1/ibkr/paper/submit", async r => { submissions++; await r.fulfill({ json: {} }); });
  await mockReview(page); await signIn(page, { ...empty, submissionsEnabled: true }); await savePlan(page);
  await page.getByRole("button", { name: "Review paper order" }).click();
  const dialog = page.getByRole("dialog", { name: "Review TEST paper order" });
  await expect(dialog).toContainText("3 shares"); await expect(dialog).toContainText("initial stop $98.00");
  await dialog.press("Escape"); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review paper order" })).toBeFocused();
  await page.getByRole("button", { name: "Review paper order" }).click();
  await dialog.getByRole("button", { name: "Confirm and submit paper order" }).click({ clickCount: 2 });
  await expect(page.getByText("Order request recorded.", { exact: false })).toBeVisible();
  expect(approvals).toBe(1); expect(submissions).toBe(1);
});

test("automatic connection uses one service and reconnect invalidates an open review", async ({ page }) => {
  let connects = 0, legacy = 0;
  await page.route("**/v1/ibkr/read-only**", r => { legacy++; return r.fulfill({ status: 410 }); });
  await page.route("**/v1/ibkr/paper/connect", r => { connects++; return r.fulfill({ json: empty }); });
  await mockReview(page); await signIn(page, { ...empty, connected: false });
  await expect.poll(() => connects).toBeGreaterThan(0);
  await page.route("**/v1/ibkr/paper/status", r => r.fulfill({ json: empty }));
  await savePlan(page); await page.getByRole("button", { name: "Review paper order" }).click();
  await expect(page.getByRole("dialog", { name: "Review TEST paper order" })).toBeVisible();
  await page.route("**/v1/ibkr/paper/status", r => r.fulfill({ json: { ...empty, connectionId: "reconnected" } }));
  await expect(page.getByRole("dialog", { name: "Review TEST paper order" })).toHaveCount(0, { timeout: 10000 });
  expect(legacy).toBe(0);
});

test("simulation stays on the existing planner and never accesses paper APIs", async ({ page }) => {
  let paperCalls = 0;
  await page.route("**/v1/ibkr/paper/**", r => { paperCalls++; return r.fulfill({ status: 403 }); });
  await page.goto("/?demo=1"); await page.getByRole("button", { name: "Workspace navigation" }).click();
  await page.getByRole("button", { name: "Trading", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trade planner", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review paper order" })).toHaveCount(0);
  expect(paperCalls).toBe(0);
});


test("the existing position drawer and Journal share broker executions without fabricated fees", async ({ page }) => {
  const plan = { schemaVersion: 1, legs: [{ id: "T1", role: "Target", allocationPercent: 100, target: { mode: "R", multipleR: 2 } }], breakeven: { activationR: 1, favorableOffset: { unit: "Dollar", value: 0 } } };
  const c = { id: "confirmed-campaign", batchId: "batch", revision: 1, symbol: "TEST", direction: "Long", state: "Open", message: null,
    automation: "Paused — review before resuming", createdAt: new Date().toISOString(), accountBinding: "opaque-account", contract: { conId: 42, currency: "USD" },
    ticket: { planId: "saved-plan", planRevision: "saved-revision", symbol: "TEST", direction: "Long", method: "Limit", quantity: 3, planningPrice: 100, hardCap: 100, stopPrice: 98, cleanupFloor: 98, sessionMode: "Regular", duration: "DAY", protectionOrderType: "STP", exitPlan: plan }, activeExitPlan: plan,
    summary: { entered: 3, exited: 1, openQuantity: 2, averageEntry: 100, grossRealized: 2, netRealized: null, fees: null, finalNetR: null, initialRisk: 6, costsComplete: false }, draft: null,
    executions: [0,1,2,3].map(i => ({ executionId: `fill-${i}`, orderId: i, effect: i===3 ? "exit" : "entry", role: i===3 ? "target" : "entry", quantity: 1, price: i===3 ? 102 : 100, occurredAt: new Date().toISOString(), commission: null })),
    slots: [0,1,2].map(i => ({ id: String(i), open: i===0 ? 0 : 1, entryStatus: "Filled", stopStatus: i===0 ? "Cancelled" : "Submitted", confirmedStop: 98, whyHeld: "", exitStatus: i===0 ? "Filled" : null, exitPrice: i===0 ? 102 : null, leg: { ...plan.legs[0], quantity: 1 } })) };
  await signIn(page, { ...empty, campaigns: [c] });
  await page.getByRole("button", { name: "Open TEST position details" }).click();
  const drawer = page.getByRole("dialog", { name: "TEST position details" });
  await expect(drawer).toContainText("2/2 confirmed");
  await expect(drawer.getByText("IBKR paper execution", { exact: true })).toHaveCount(4);
  await drawer.getByRole("button", { name: "Open Journal trade" }).click();
  const row = page.locator('[data-journal-trade-id="paper:confirmed-campaign"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText(/unavailable/i);
  await expect(row).toContainText("IBKR paper");
  await expect(row).toContainText("Not reviewed");
  await expect(row).not.toContainText("Grade C");
  await expect(row).toHaveCount(1);
  await expect(page.getByText("BROKER-CONFIRMED PAPER EXECUTIONS", {exact:true})).toBeVisible();
  await expect(page.getByText("SIMULATED · NOT BROKER CONFIRMED", {exact:true})).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "TEST position details" })).toHaveCount(0);
});

test("missing execution timestamps and reconciliation do not crash the position drawer", async ({ page }) => {
  const plan = { schemaVersion: 1, legs: [{ id: "T1", role: "Target", allocationPercent: 100, target: { mode: "R", multipleR: 2 } }], breakeven: { activationR: 1, favorableOffset: { unit: "Dollar", value: 0 } } };
  const c = { id: "confirmed-campaign", batchId: "batch", revision: 1, symbol: "TEST", direction: "Long", state: "Needs reconciliation", message: "Protection identity needs reconciliation",
    automation: "Paused — review before resuming", createdAt: new Date().toISOString(), accountBinding: "opaque-account", contract: { conId: 42, currency: "USD" },
    ticket: { planId: "saved-plan", planRevision: "saved-revision", symbol: "TEST", direction: "Long", method: "Limit", quantity: 3, planningPrice: 100, hardCap: 100, stopPrice: 98, cleanupFloor: 98, sessionMode: "Regular", duration: "DAY", protectionOrderType: "STP", exitPlan: plan }, activeExitPlan: plan,
    summary: { entered: 3, exited: 1, openQuantity: 2, averageEntry: 100, grossRealized: 2, netRealized: null, fees: null, finalNetR: null, initialRisk: 6, costsComplete: false }, draft: null,
    executions: [0,1,2,3].map(i => ({ executionId: `fill-${i}`, orderId: i, effect: i===3 ? "exit" : "entry", role: i===3 ? "target" : "entry", quantity: 1, price: i===3 ? 102 : 100, occurredAt: "", commission: null })),
    slots: [0,1,2].map(i => ({ id: String(i), open: i===0 ? 0 : 1, entryStatus: "Filled", stopStatus: i===0 ? "Cancelled" : "Submitted", confirmedStop: 98, whyHeld: "trigger", exitStatus: i===0 ? "Filled" : null, exitPrice: i===0 ? 102 : null, leg: { ...plan.legs[0], quantity: 1 } })) };
  await signIn(page, { ...empty, campaigns: [c] });
  await page.getByRole("button", { name: "Open TEST position details" }).click();
  const drawer = page.getByRole("dialog", { name: "TEST position details" });
  await expect(drawer).toContainText("2/2 confirmed");
  await expect(drawer.getByText("IBKR paper execution", { exact: true })).toHaveCount(4);
  await expect(drawer).toContainText("Protection identity needs reconciliation");
  await expect(drawer.getByRole("button", {name:"Reconcile owned campaign",exact:true})).toBeEnabled();
  await drawer.getByRole("button", {name:"Reconcile owned campaign",exact:true}).click();
  await expect(drawer).toContainText("This sends no orders");
});


test("paper sign-in stays contained at medium, mobile and desktop widths", async ({ page }) => {
  await page.goto("/?paper=1");
  for (const width of [765, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});


test("account summary precedes planner and positions align beside setup only in wide workspaces", async ({ page }) => {
  await signIn(page, { ...empty, account:null });
  const summary = page.getByRole("region", { name: "IBKR account summary" });
  await expect(summary.getByText("Unavailable", { exact: true })).toHaveCount(2);
  for (const width of [1600, 1190, 390, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    const boxes = await page.evaluate(() => {
      const rect = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom }; };
      return { summary:rect(".broker-account-summary"), heading:rect(".trade-commandbar"), setup:rect(".trade-ticket"), positions:rect(".position-command-center"), editor:rect(".planner-editing-column"), overflow:document.documentElement.scrollWidth > innerWidth };
    });
    expect(boxes.summary.bottom).toBeLessThanOrEqual(boxes.heading.y);
    if ((await page.locator(".planner-workspace").boundingBox())!.width >= 960) {
      expect(Math.abs(boxes.setup.y - boxes.positions.y)).toBeLessThan(2);
      expect(boxes.positions.x).toBeGreaterThan(boxes.setup.right);
    } else {
      await expect(page.getByRole("tab", {name:/Positions/})).toBeVisible();
      await expect(page.locator(".position-command-center")).not.toBeVisible();
    }
    expect(boxes.overflow).toBe(false);
  }
});

test("stale account snapshot stays visible without opening connection details", async ({ page }) => {
  await signIn(page, { ...empty, readiness:{state:"blocked",message:"Connection requires attention. " + "Reconciliation and fresh quotes are required before trading. ".repeat(8)}, broker: { mode:"read-only", source:"IBKR TWS", connectionStatus:"stale", dataStatus:"stale", lastSuccessfulUpdate:"2026-09-15T12:00:00Z", error:null, account:{ id:"fixture", maskedId:"DU••10", value:12345, currency:"USD", source:"fixture", observedAt:"2026-09-15T12:00:00Z", available:true }, positions:[], openOrders:[] } });
  const summary = page.getByRole("region", { name:"IBKR account summary" });
  await expect(summary.getByText("12,345 USD · Stale", { exact:true })).toBeVisible();
  await expect(summary.locator("dd").filter({ hasText:"Stale" })).toHaveCount(2);
  await expect(summary.locator("details.broker-connection")).not.toHaveAttribute("open");
  await page.setViewportSize({ width:390, height:844 });
  await summary.locator("details.broker-connection > summary").press("Enter");
  await expect(summary.getByText(/Connection requires attention/)).toBeVisible();
  expect(await summary.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});


test("QC derived stop precision and symbol/source filters preserve the existing controls", async ({ page }) => {
  await page.setViewportSize({ width:1600, height:1000 });
  await page.goto("/?demo=1");
  await page.getByRole("button", {name:"Workspace navigation"}).click();
  await page.getByRole("button", {name:"Trading",exact:true}).click();
  await page.getByLabel("ATR multiplier").fill("1.234567");
  await expect(page.getByLabel("Stop price", {exact:true})).toHaveValue("97.53");
  await page.getByRole("button", {name:"Short",exact:true}).click();
  await expect(page.getByLabel("Stop price", {exact:true})).toHaveValue("102.47");
  await page.getByLabel("Find position symbol").fill("aapl");
  await expect(page.getByRole("button", {name:"Open AAPL position details"})).toBeVisible();
  await expect(page.getByRole("button", {name:"Open NVDA position details"})).toHaveCount(0);
  await page.getByLabel("Find position symbol").fill("NO_MATCH");
  await expect(page.getByText("No matching open positions.", {exact:true})).toBeVisible();
  await page.getByLabel("Find position symbol").fill("");
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("tab", {name:"Plan",exact:true}).click();
  await page.getByLabel("Runner A trailing method").selectOption({label:"Percent"});
  expect((await page.getByLabel("Runner A trailing method").boundingBox())!.width).toBeGreaterThan(120);
  await page.setViewportSize({width:1600,height:1000});
  await page.getByRole("button", {name:"Journal",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Trading journal",exact:true})).toBeVisible();
  await page.getByLabel("Journal record source").selectOption("paper");
  await expect(page.getByText("No trades match these filters.", {exact:true})).toBeVisible();
  await expect(page.locator(".metric-card").filter({hasText:"Win rate"})).toHaveAttribute("data-metric-tone", "unavailable");
  await expect(page.locator(".metric-card").filter({hasText:"Avg planned R:R"})).toHaveAttribute("data-metric-tone", "unavailable");
  await page.getByLabel("Journal record source").selectOption("all");
  await page.getByLabel("Find Journal symbol").fill("HOOD");
  await expect(page.locator(".trade-table .journal-trade-group")).toHaveCount(1);
  // One observed result must not shade a fabricated path down to the baseline.
  await expect(page.locator(".equity-chart circle")).toHaveCount(1);
  await expect(page.locator(".equity-chart polygon, .equity-chart polyline")).toHaveCount(0);
  for (const width of [1600,390,1600]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});


test("fresh broker quote updates only the draft and approved session controls retain server locks", async ({page}) => {
  let submissions=0;
  await page.route("**/v1/ibkr/paper/submit", route => {submissions++; return route.fulfill({json:{}});});
  await page.route("**/v1/ibkr/paper/quote/*", route => route.fulfill({json:{contract:{symbol:"NVDA"},observedAt:new Date().toISOString(),executable:true,error:null,quote:{bid:99.98,ask:100.02}}}));
  await signIn(page);
  await page.getByLabel("Stock symbol",{exact:true}).fill("NVDA");
  await page.getByRole("button",{name:"Use fresh ask in draft"}).click();
  await expect(page.getByLabel("Entry price cap",{exact:true})).toHaveValue("100.02");
  await expect(page.getByRole("button",{name:"Review paper order",exact:true})).toBeDisabled();
  await page.getByText("Paper test session · not started",{exact:true}).click();
  await expect(page.getByRole("button",{name:"Start approved 200-trade paper session"})).toBeDisabled();
  expect(submissions).toBe(0);
});
