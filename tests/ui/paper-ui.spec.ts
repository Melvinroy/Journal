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
  await page.route("**/v1/ibkr/paper/identity", r => r.fulfill({ json: { userId: "test-user", email: "test@example.com", linked: true, accountBinding: "test-binding", environment: "paper" } }));
  await page.route("**/v1/ibkr/paper/status", r => r.fulfill({ json: { ...status, lastReconciled: status.lastReconciled === empty.lastReconciled ? new Date().toISOString() : status.lastReconciled } }));
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
  await expect(page.getByRole("button", { name: "Review order" })).toBeDisabled();
  for (const width of [1440, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const status = page.getByLabel("TWS connection: Paper connected");
    await status.focus(); await status.press("Enter");
    await expect(page.getByText(empty.readiness.message, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await status.press("Enter");
  }
});

test("late fees update the same Position and Journal record with exact net and R", async ({ page }) => {
  const plan = { schemaVersion: 1, legs: [{ id: "T1", role: "Target", allocationPercent: 100, target: { mode: "R", multipleR: 2 } }], breakeven: { activationR: 1, favorableOffset: { unit: "Dollar", value: 0 } } };
  const campaign = { id: "fee-campaign", batchId: "batch", revision: 1, symbol: "FEES", direction: "Long", state: "Closed", message: null,
    automation: "Complete", createdAt: new Date().toISOString(), accountBinding: "test-binding", contract: { conId: 43, currency: "USD" },
    ticket: { planId: "plan", planRevision: "saved", symbol: "FEES", direction: "Long", method: "Limit", quantity: 1, planningPrice: 100, hardCap: 100, stopPrice: 98, cleanupFloor: 98, sessionMode: "Regular", duration: "DAY", protectionOrderType: "STP", exitPlan: plan }, activeExitPlan: plan,
    summary: { entered: 1, exited: 1, openQuantity: 0, averageEntry: 100, grossRealized: 4, netRealized: null as number | null, fees: null as number | null, finalNetR: null as number | null, initialRisk: 2, costsComplete: false }, draft: null,
    executions: [{ executionId: "fee-entry", orderId: 1, effect: "entry", role: "entry", quantity: 1, price: 100, occurredAt: new Date().toISOString(), commission: null as number | null },
      { executionId: "fee-exit", orderId: 2, effect: "exit", role: "target", quantity: 1, price: 104, occurredAt: new Date().toISOString(), commission: null as number | null }],
    slots: [{ id: "0", open: 0, entryStatus: "Filled", stopStatus: "Cancelled", confirmedStop: 98, whyHeld: "", exitStatus: "Filled", exitPrice: 104, leg: { ...plan.legs[0], quantity: 1 } }] };
  await signIn(page, { ...empty, campaigns: [campaign] });
  await page.getByRole("button", { name: /Recently closed \(1\)/ }).click();
  await page.getByRole("button", { name: "Open FEES position details" }).click();
  const drawer = page.getByRole("dialog", { name: "FEES position details" });
  const positionValue = (label: string) => drawer.locator(".position-detail-grid > span").filter({ has: page.getByText(label, { exact: true }) }).locator("b");
  await expect(positionValue("Realized P&L")).toHaveText("Unavailable");
  await expect(positionValue("Filled entry")).toHaveText("1 sh");
  await expect(positionValue("Exited")).toHaveText("1 sh");
  await expect(positionValue("Remaining")).toHaveText("0 sh");
  await drawer.getByRole("button", { name: "Open Journal trade" }).click();
  const row = page.locator('[data-journal-trade-id="paper:fee-campaign"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(/unavailable/i);
  Object.assign(campaign.summary, { netRealized: 3, fees: 1, finalNetR: 1.5, costsComplete: true });
  campaign.executions.forEach(execution => { execution.commission = .5; });
  campaign.revision++;
  await expect(row).toContainText("+1.50R");
  await expect(row).toContainText("+$3.00");
  const details = page.getByRole("region", { name: "FEES entry and exit details" });
  await expect(details).toContainText("1 / 1 / 0");
  await expect(details).toContainText("+$4.00 / +$1.00 / +$3.00");
  await expect(details.locator(".journal-fill-row")).toHaveCount(2);
  await expect(row).toHaveCount(1);
  await details.getByRole("button", { name: "Open linked Plan & Position" }).click();
  await page.getByRole("button", { name: "Open FEES position details" }).click();
  await expect(positionValue("Realized P&L")).toHaveText("+$3.00");
  await expect(positionValue("Actual initial risk")).toHaveText("$2.00");
  await expect(positionValue("Remaining")).toHaveText("0 sh");
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
  await page.getByRole("button", { name: "Review order" }).click();
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
    expect(tickets[0].savedPlan).toMatchObject({ schemaVersion: 2, planId: tickets[0].planId,
      planRevision: tickets[0].planRevision, symbol: tickets[0].symbol, entryPrice: tickets[0].planningPrice,
      stopPrice: tickets[0].stopPrice, executionQuantity: tickets[0].quantity, exitPlan: tickets[0].exitPlan });
    expect(tickets[0].savedPlan.savedAt).toBeTruthy();
    expect(tickets[0].savedPlan.result.valid).toBe(true);
    await r.fulfill({ json: { id: "batch", digest: "a".repeat(64), tickets, sourceIdentity: "test-source", validUntil: new Date(Date.now()+60000).toISOString() } });
  });
}

test("Journal recovers a transient validator clock error without reloading or writing", async ({ page }) => {
  await signIn(page);
  let reads = 0, writes = 0;
  await page.route("**/rest/v1/trades**", r => {
    if (r.request().method() !== "GET") writes++;
    reads++;
    return reads === 1 ? r.fulfill({ status: 401, json: { message: "JWT issued at future", code: "PGRST303" } }) : r.fulfill({ json: [] });
  });
  await page.reload();
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await expect.poll(() => reads).toBe(2);
  await expect(page.getByText("JWT issued at future", { exact: false })).toHaveCount(0);
  expect(writes).toBe(0);
});

test("Journal leaves a persistent token rejection visible after one read retry", async ({ page }) => {
  await signIn(page);
  let reads = 0;
  await page.route("**/rest/v1/trades**", r => { reads++; return r.fulfill({ status: 401, json: { message: "JWT issued at future", code: "PGRST303" } }); });
  await page.reload();
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await expect.poll(() => reads).toBe(2);
  await expect(page.getByText("JWT issued at future", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry cloud history" })).toBeVisible();
  await page.getByRole("button", { name: "Retry cloud history" }).click();
  await expect.poll(() => reads).toBe(4);
});

for (const loss of ["connection", "submission lock"] as const) {
  test(`position action review blocks confirmation after loss of ${loss}`, async ({ page }) => {
    const plan = { schemaVersion: 1, legs: [{ id: "T1", role: "Target", allocationPercent: 100, target: { mode: "R", multipleR: 2 } }], breakeven: { activationR: 1, favorableOffset: { unit: "Dollar", value: 0 } } };
    const campaign = { id: "action-campaign", batchId: "batch", revision: 1, symbol: "TEST", direction: "Long", state: "Open", message: null,
      automation: "Paused", createdAt: new Date().toISOString(), accountBinding: "test-binding", contract: { conId: 42, currency: "USD" },
      ticket: { planId: "plan", planRevision: "saved", symbol: "TEST", direction: "Long", method: "Limit", quantity: 1, planningPrice: 100, hardCap: 100, stopPrice: 98, cleanupFloor: 98, sessionMode: "Regular", duration: "DAY", protectionOrderType: "STP", exitPlan: plan }, activeExitPlan: plan,
      summary: { entered: 1, exited: 0, openQuantity: 1, averageEntry: 100, grossRealized: 0, netRealized: null, fees: null, finalNetR: null, initialRisk: 2, costsComplete: false }, draft: null,
      executions: [{ executionId: "entry", orderId: 1, effect: "entry", role: "entry", quantity: 1, price: 100, occurredAt: new Date().toISOString(), commission: null }],
      slots: [{ id: "0", open: 1, entryStatus: "Filled", stopStatus: "Submitted", confirmedStop: 98, whyHeld: "", exitStatus: null, exitPrice: null, leg: { ...plan.legs[0], quantity: 1 } }] };
    const status = { ...empty, submissionsEnabled: true, campaigns: [campaign] };
    const actions: Record<string, unknown>[] = [];
    await page.route("**/v1/ibkr/paper/campaigns/*/actions", route => { actions.push(route.request().postDataJSON()); return route.fulfill({ json: {} }); });
    await page.route("**/v1/ibkr/paper/connect", route => route.fulfill({ json: status }));
    await signIn(page, status);
    await page.getByRole("button", { name: "Open TEST position details" }).click();
    const drawer = page.getByRole("dialog", { name: "TEST position details" });
    const launch = drawer.getByRole("button", { name: "Cancel unfilled entry", exact: true });
    await launch.click();
    const confirm = drawer.getByRole("button", { name: "Confirm cancel unfilled entry", exact: true });
    await expect(confirm).toBeEnabled();
    if (loss === "connection") status.connected = false;
    else status.submissionsEnabled = false;
    // Polling must consume the changed status before asserting the review state.
    await expect(launch).toBeDisabled();
    await expect(confirm).toBeDisabled();
    expect(actions).toEqual([]);
    await drawer.getByRole("button", { name: "Cancel action review" }).click();
    const recover = drawer.getByRole("button", { name: "Reconcile owned campaign", exact: true });
    if (loss === "connection") {
      await expect(recover).toBeDisabled();
    } else {
      await expect(recover).toBeEnabled();
      await recover.click();
      await drawer.getByRole("button", { name: "Confirm reconcile owned campaign", exact: true }).click();
      await expect.poll(() => actions.length).toBe(1);
      expect(actions[0]).toMatchObject({ action: "recover", revision: 1, connectionId: "connection-1" });
    }
  });
}

function recordedCampaign(symbol: string) {
  const plan = { schemaVersion: 1, legs: [{ id: "T1", role: "Target", allocationPercent: 100, target: { mode: "R", multipleR: 2 } }], breakeven: { activationR: 1, favorableOffset: { unit: "Dollar", value: 0 } } };
  return { id: `record-${symbol}`, batchId: `batch-${symbol}`, revision: 1, symbol, direction: "Long", state: "Open", message: null,
    automation: "Paused", createdAt: "2026-09-20T14:00:00Z", accountBinding: "test-binding", contract: { conId: symbol === "ALFA" ? 101 : 102, currency: "USD" },
    ticket: { planId: `plan-${symbol}`, planRevision: "saved", symbol, direction: "Long", method: "Limit", quantity: 2, planningPrice: 100, hardCap: 100, stopPrice: 98, cleanupFloor: 98, sessionMode: "Regular", duration: "DAY", protectionOrderType: "STP", exitPlan: plan }, activeExitPlan: plan,
    summary: { entered: 1, exited: 0, openQuantity: 1, averageEntry: 100, grossRealized: 0, netRealized: null, fees: null, finalNetR: null, initialRisk: 2, costsComplete: false }, draft: null,
    executions: [{ executionId: `${symbol}-entry`, orderId: symbol === "ALFA" ? 10 : 20, effect: "entry", role: "entry", quantity: 1, price: 100, occurredAt: "2026-09-20T14:00:00Z", commission: null }],
    slots: [{ id: "0", open: 1, entryStatus: "Filled", stopStatus: "Submitted", confirmedStop: 98, whyHeld: "", exitStatus: null, exitPrice: null, leg: { ...plan.legs[0], quantity: 1 } },
      { id: "1", open: 0, entryStatus: "Submitted", stopStatus: "Pending", confirmedStop: null, whyHeld: "", exitStatus: null, exitPrice: null, leg: null }] };
}

test("recorded campaign and Journal survive reload while connection fails", async ({ page }) => {
  let unexpected = 0, connects = 0;
  await page.route("**/v1/ibkr/paper/**", route => { unexpected++; return route.fulfill({ status: 409, json: { detail: "Unexpected fixture request" } }); });
  await page.route("**/v1/ibkr/paper/connect", route => { connects++; return route.fulfill({ status: 409, json: { detail: "TWS is unavailable" } }); });
  await signIn(page, { ...empty, connected: false, campaigns: [recordedCampaign("ALFA")], broker: { mode: "read-only", source: "IBKR TWS", connectionStatus: "disconnected", dataStatus: "stale", lastSuccessfulUpdate: "2026-09-20T14:00:00Z", error: null, account: { id: "fixture", maskedId: "DU••10", value: 12345, currency: "USD", source: "IBKR accountSummary", observedAt: "2026-09-20T14:00:00Z", available: true }, positions: [], openOrders: [] } });
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    await expect(page.getByText("TWS is unavailable", { exact: true })).toBeVisible();
    await expect(page.getByText("12,345 USD · Stale", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open ALFA position details" }).click();
    const drawer = page.getByRole("dialog", { name: "ALFA position details" });
    await expect(drawer).toContainText("Protection unconfirmed");
    await expect(drawer).toContainText("Last TWS confirmation · stale");
    await expect(drawer.locator(".position-detail-grid > span").filter({ has: page.getByText("Remaining", { exact: true }) })).toContainText("1 sh");
    await drawer.getByRole("button", { name: "Open Journal trade" }).click();
    await expect(page.locator('[data-journal-trade-id="paper:record-ALFA"]')).toHaveCount(1);
    await expect(page.getByRole("region", { name: "ALFA entry and exit details" })).toContainText("1 / 0 / 1");
    await expect(page.getByText("No records yet", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Open linked Plan & Position" }).click();
  }
  expect(connects).toBeGreaterThanOrEqual(2); expect(unexpected).toBe(0);
});

test("two campaigns keep cancel and cleanup actions attributed to the selected campaign", async ({ page }) => {
  const a = recordedCampaign("ALFA"), b = recordedCampaign("BETA");
  const beforeB = JSON.stringify(b);
  const actions: { path: string; body: Record<string, unknown> }[] = [];
  let unexpected = 0;
  await page.route("**/v1/ibkr/paper/**", route => { unexpected++; return route.fulfill({ status: 409, json: { detail: "Unexpected fixture request" } }); });
  await page.route("**/v1/ibkr/paper/campaigns/*/actions", route => {
    actions.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    a.revision++; return route.fulfill({ json: {} });
  });
  await signIn(page, { ...empty, submissionsEnabled: true, campaigns: [a, b] });
  await page.getByRole("button", { name: "Open ALFA position details" }).click();
  const drawer = page.getByRole("dialog", { name: "ALFA position details" });
  await drawer.getByRole("button", { name: "Cancel unfilled entry", exact: true }).click();
  expect(actions).toHaveLength(0);
  await drawer.getByRole("button", { name: "Confirm cancel unfilled entry", exact: true }).click();
  await expect(drawer.getByRole("group", { name: "Confirm paper position action" })).toHaveCount(0);
  await drawer.getByRole("button", { name: "Close with bounded limit", exact: true }).click();
  await expect(drawer.getByRole("group", { name: "Confirm paper position action" })).toContainText("Revision 2");
  await drawer.getByRole("button", { name: "Confirm close with bounded limit", exact: true }).click();
  await expect.poll(() => actions.length).toBe(2);
  expect(actions.map(action => [action.path, action.body.action, action.body.revision])).toEqual([
    ["/v1/ibkr/paper/campaigns/record-ALFA/actions", "cancel-entry", 1],
    ["/v1/ibkr/paper/campaigns/record-ALFA/actions", "cleanup", 2],
  ]);
  expect(actions[0].body.commandId).not.toBe(actions[1].body.commandId);
  expect(actions.every(action => action.body.connectionId === "connection-1")).toBe(true);
  await drawer.press("Escape");
  await page.getByRole("button", { name: "Open BETA position details" }).click();
  const other = page.getByRole("dialog", { name: "BETA position details" });
  await expect(other).toContainText("1/1 confirmed");
  await expect(other.getByText("IBKR paper execution", { exact: true })).toHaveCount(1);
  await other.getByRole("button", { name: "Open Journal trade" }).click();
  await expect(page.getByRole("region", { name: "BETA entry and exit details" })).toContainText("1 / 0 / 1");
  await expect(page.locator('[data-journal-trade-id="paper:record-BETA"]')).toHaveCount(1);
  expect(JSON.stringify(b)).toBe(beforeB); expect(unexpected).toBe(0);
});

test("Journal discards an earlier user's response even when it resolves after the account switch", async ({ page }) => {
  await page.addInitScript(() => {
    const readText = Response.prototype.text;
    Response.prototype.text = function () {
      const body = readText.call(this);
      if (!this.url.includes("/rest/v1/trades")) return body;
      return body.then(text => {
        if (text.includes('"symbol":"USERA"')) {
          // Observe the client's actual body read, then yield past its promise
          // continuations and two render frames before inspecting the result.
          const channel = new MessageChannel();
          channel.port1.onmessage = () => {
            channel.port1.close();
            channel.port2.close();
            requestAnimationFrame(() => requestAnimationFrame(() => {
              document.documentElement.dataset.lateJournalResponse = "processed";
            }));
          };
          channel.port2.postMessage(null);
        }
        return text;
      });
    };
  });
  const user = (label: "a" | "b") => ({
    id: `00000000-0000-0000-0000-00000000000${label === "a" ? "1" : "2"}`,
    email: `${label}@example.test`,
    email_confirmed_at: new Date().toISOString(),
    aud: "authenticated",
  });
  const row = (label: "a" | "b") => ({
    id: `trade-${label}`,
    symbol: `USER${label.toUpperCase()}`,
    side: "Long",
    setup: `Owned by ${label.toUpperCase()}`,
    trade_date: "2026-09-20",
    pnl: 1,
    realized_r: 0.5,
    dollar_risk: 2,
    planned_r: 2,
    grade: "B",
  });
  let releaseA!: () => void;
  const holdA = new Promise<void>(resolve => { releaseA = resolve; });
  let aReadStarted!: () => void;
  const aRead = new Promise<void>(resolve => { aReadStarted = resolve; });

  await page.route("https://brontide-test.supabase.co/**", async route => {
    const request = route.request();
    if (request.url().includes("/token")) {
      const payload = request.postData() ?? "";
      const label = payload.includes("b@example.test") || payload.includes("b%40example.test") ? "b" : "a";
      await route.fulfill({ json: {
        access_token: `access-${label}`,
        refresh_token: `refresh-${label}`,
        expires_in: 3600,
        token_type: "bearer",
        user: user(label),
      } });
      return;
    }
    await route.fulfill({ status: request.url().includes("/logout") ? 204 : 200, json: [] });
  });
  await page.route("**/v1/ibkr/paper/identity", async route => {
    const label = route.request().headers().authorization?.includes("access-b") ? "b" : "a";
    await route.fulfill({ json: { userId: user(label).id, email: user(label).email, linked: true, accountBinding: "test-binding", environment: "paper" } });
  });
  await page.route("**/v1/ibkr/paper/status", route => route.fulfill({ json: empty }));
  await page.route("**/v1/ibkr/paper/signout", route => route.fulfill({ json: empty }));
  await page.route("**/rest/v1/trades**", async route => {
    const isA = route.request().headers().authorization?.includes("access-a");
    if (isA) {
      aReadStarted();
      await holdA;
    }
    await route.fulfill({ json: [row(isA ? "a" : "b")] });
  });

  await navigate(page);
  await page.getByLabel("Email address").fill("a@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await aRead;
  await page.getByRole("button", { name: "Sign out", exact: true }).first().click();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.getByLabel("Email address").fill("b@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await expect(page.getByText("USERB", { exact: true })).toBeVisible();
  const lateResponse = page.waitForResponse(response =>
    response.url().includes("/rest/v1/trades") &&
    response.request().headers().authorization?.includes("access-a") === true);
  releaseA();
  expect(await (await lateResponse).finished()).toBeNull();
  await expect(page.locator("html")).toHaveAttribute("data-late-journal-response", "processed");
  await expect(page.getByText("USERA", { exact: true })).toHaveCount(0);
  await expect(page.getByText("USERB", { exact: true })).toBeVisible();
});

test("exact confirmation, keyboard dismissal, and double-click submit guard", async ({ page }) => {
  let approvals = 0, submissions = 0;
  await page.route("**/v1/ibkr/paper/batches/batch/approve", async r => { approvals++; await r.fulfill({ json: {} }); });
  await page.route("**/v1/ibkr/paper/submit", async r => { submissions++; await r.fulfill({ json: {} }); });
  await mockReview(page); await signIn(page, { ...empty, submissionsEnabled: true }); await savePlan(page);
  await page.getByRole("button", { name: "Review order" }).click();
  const dialog = page.getByRole("dialog", { name: "Review TEST paper order" });
  await expect(dialog).toContainText("3 shares"); await expect(dialog).toContainText("initial stop $98.00");
  await dialog.press("Escape"); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review order" })).toBeFocused();
  await page.getByRole("button", { name: "Review order" }).click();
  await dialog.getByRole("button", { name: "Confirm and submit paper order" }).click({ clickCount: 2 });
  await expect(page.getByText("Order request recorded.", { exact: false })).toBeVisible();
  expect(approvals).toBe(1); expect(submissions).toBe(1);
});

test("order review expires on its own timer without a status refresh", async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let economicRequests = 0;
  await page.route("**/v1/ibkr/paper/**", route => { economicRequests++; return route.fulfill({ status: 409, json: { detail: "Unexpected fixture request" } }); });
  await page.route("**/v1/ibkr/paper/batches", async route => {
    const now = await page.evaluate(() => Date.now());
    const { tickets } = route.request().postDataJSON();
    await route.fulfill({ json: { id: "expiry-batch", digest: "a".repeat(64), tickets, sourceIdentity: "fixture", validUntil: new Date(now + 1000).toISOString() } });
  });
  await signIn(page, { ...empty, submissionsEnabled: true }); await savePlan(page);
  await page.clock.runFor(2000);
  await page.getByRole("button", { name: "Review order", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review TEST paper order" });
  const confirm = dialog.getByRole("button", { name: "Confirm and submit paper order" });
  await expect(confirm).toBeEnabled();
  await page.clock.runFor(1001);
  await expect(confirm).toBeDisabled();
  expect(economicRequests).toBe(0);
});

test("editing and resaving a plan requires a fresh order review", async ({ page }) => {
  const prices: number[] = [];
  await page.route("**/v1/ibkr/paper/batches", async route => {
    const { tickets } = route.request().postDataJSON(); prices.push(tickets[0].planningPrice);
    await route.fulfill({ json: { id: `revision-${prices.length}`, digest: "b".repeat(64), tickets, sourceIdentity: "fixture", validUntil: new Date(Date.now()+60000).toISOString() } });
  });
  await signIn(page); await savePlan(page);
  await page.getByRole("button", { name: "Review order", exact: true }).click();
  await page.getByRole("dialog", { name: "Review TEST paper order" }).press("Escape");
  await page.getByLabel("Captured planning entry price").fill("101");
  await expect(page.getByRole("button", { name: "Review order", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page.getByRole("button", { name: "Review order", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Review TEST paper order" })).toContainText("Entry cap $101.00");
  expect(prices).toEqual([100, 101]);
});

test("expiry during pending approval prevents the subsequent submit request", async ({ page }) => {
  await page.clock.install(); await page.clock.pauseAt(new Date());
  let approvals = 0, submissions = 0, unexpected = 0;
  let releaseApproval!: () => void;
  const heldApproval = new Promise<void>(resolve => { releaseApproval = resolve; });
  await page.route("**/v1/ibkr/paper/**", route => { unexpected++; return route.fulfill({ status: 409, json: { detail: "Unexpected fixture request" } }); });
  await page.route("**/v1/ibkr/paper/batches", async route => {
    const now = await page.evaluate(() => Date.now());
    const { tickets } = route.request().postDataJSON();
    await route.fulfill({ json: { id: "held-batch", digest: "a".repeat(64), tickets, sourceIdentity: "fixture", validUntil: new Date(now+1000).toISOString() } });
  });
  await page.route("**/v1/ibkr/paper/batches/held-batch/approve", async route => { approvals++; await heldApproval; await route.fulfill({ json: {} }); });
  await page.route("**/v1/ibkr/paper/submit", route => { submissions++; return route.fulfill({ json: {} }); });
  await signIn(page, { ...empty, submissionsEnabled: true }); await savePlan(page); await page.clock.runFor(2000);
  await page.getByRole("button", { name: "Review order", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review TEST paper order" });
  await dialog.getByRole("button", { name: "Confirm and submit paper order" }).click();
  await expect.poll(() => approvals).toBe(1);
  await page.clock.runFor(1001); releaseApproval();
  await expect(dialog).toContainText("Review expired or plan changed during approval.");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
  expect(submissions).toBe(0); expect(unexpected).toBe(0);
});

test("automatic connection uses one service and reconnect invalidates an open review", async ({ page }) => {
  let connects = 0, legacy = 0;
  await page.route("**/v1/ibkr/read-only**", r => { legacy++; return r.fulfill({ status: 410 }); });
  await page.route("**/v1/ibkr/paper/connect", r => { connects++; return r.fulfill({ json: empty }); });
  await mockReview(page); await signIn(page, { ...empty, connected: false });
  await expect.poll(() => connects).toBeGreaterThan(0);
  await page.route("**/v1/ibkr/paper/status", r => r.fulfill({ json: empty }));
  await savePlan(page); await page.getByRole("button", { name: "Review order" }).click();
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
  await expect(page.getByRole("button", { name: "Review order" })).toHaveCount(0);
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
  for (const width of [1280,390,1280]) {
    await page.setViewportSize({width,height:900});
    const bounds = await drawer.evaluate(el => {
      const panel = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll('.broker-campaign-actions button')).map(button => {
        const r = button.getBoundingClientRect();
        return r.left >= panel.left && r.right <= panel.right && r.width > 60;
      });
    });
    expect(bounds.every(Boolean)).toBe(true);
    await expect(drawer.getByRole('button',{name:'Cancel action review'})).toBeVisible();
  }
  await drawer.getByRole('button',{name:'Cancel action review'}).press('Enter');
  await expect(drawer.getByRole('group',{name:'Confirm paper position action'})).toHaveCount(0);
  // A live socket is not fresh protection evidence after a failed reconciliation.
  await page.route("**/v1/ibkr/paper/status", r => r.fulfill({ json: { ...empty, campaigns: [c], lastReconciled: "2020-01-01T00:00:00Z", error: "Snapshot incomplete" } }));
  await page.reload();
  await page.getByRole("button", { name: "Open TEST position details" }).click();
  await expect(page.getByRole("dialog", { name: "TEST position details" })).toContainText("Protection unconfirmed");
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


test("fresh broker quote updates only the main draft and testing remains a progress view", async ({page}) => {
  let submissions=0;
  await page.route("**/v1/ibkr/paper/submit", route => {submissions++; return route.fulfill({json:{}});});
  await page.route("**/v1/ibkr/paper/quote/*", route => route.fulfill({json:{contract:{symbol:"NVDA"},observedAt:new Date().toISOString(),executable:true,error:null,quote:{bid:99.98,ask:100.02}}}));
  await signIn(page);
  await page.getByLabel("Stock symbol",{exact:true}).fill("NVDA");
  await page.getByRole("button",{name:"Use ask in draft"}).click();
  await expect(page.getByLabel("Entry price cap",{exact:true})).toHaveValue("100.02");
  await expect(page.getByRole("button",{name:"Review order",exact:true})).toBeDisabled();
  await expect(page.getByRole("link", { name: "Verification", exact: true })).toBeVisible();
  await expect(page.getByText("Testing · no session record",{exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:/Start approved|Resume approved/})).toHaveCount(0);
  expect(submissions).toBe(0);
});

test("quotes and execution fields stay inside trade setup across resizing without changing the draft", async ({page}) => {
  let submissions = 0;
  await page.route("**/v1/ibkr/paper/submit", r => { submissions++; return r.fulfill({json:{}}); });
  await page.route("**/v1/ibkr/paper/quote/*", r => r.fulfill({json:{contract:{symbol:"TEST"},observedAt:new Date().toISOString(),executable:true,error:null,quote:{bid:99.98,ask:100.02}}}));
  await signIn(page); await savePlan(page);
  const setup = page.getByRole("region", {name:"Trade setup",exact:true});
  for (const width of [1600,1280,1024,768,390,1600]) {
    await page.setViewportSize({width,height:900});
    await expect(setup.getByRole("button", {name:"Refresh bid / ask"})).toBeVisible();
    await expect(setup.getByLabel("Order method",{exact:true})).toBeVisible();
    await expect(setup.getByLabel("Requested shares",{exact:true})).toHaveValue("3");
    const bounds = await setup.evaluate(el => {
      const parent=el.getBoundingClientRect();
      return [...el.querySelectorAll('.paper-quote button,.broker-execution-fields input,.broker-execution-fields select')].every(n => {const b=n.getBoundingClientRect();return b.left>=parent.left && b.right<=parent.right+1;});
    });
    expect(bounds).toBe(true);
    expect((await setup.boundingBox())!.y).toBeLessThan((await page.getByRole("region",{name:"After-fill plan",exact:true}).boundingBox())!.y);
  }
  await setup.getByRole("button", {name:"Refresh bid / ask"}).press("Enter");
  await expect(setup.getByRole("region",{name:"Executable broker quote"})).toContainText("100.02");
  await expect(page.getByLabel("Captured planning entry price")).toHaveValue("100");
  await expect(page.getByRole("button",{name:"Unsave plan",exact:true})).toBeVisible();
  await setup.getByRole("button", {name:"Use ask in draft"}).click();
  await expect(page.getByLabel("Captured planning entry price")).toHaveValue("100.02");
  await expect(page.getByLabel("Entry price cap")).toHaveValue("100.02");
  await expect(page.getByRole("button",{name:"Review order",exact:true})).toBeDisabled();
  await page.getByLabel("Order method",{exact:true}).selectOption("Breakout");
  await expect(setup.getByLabel("Entry trigger",{exact:true})).toBeVisible();
  await expect(setup.locator(".trade-session-static")).toContainText("Stop-limit breakout");
  expect(submissions).toBe(0);
});

test("quote application uses the chosen side and rejects stale, malformed and unavailable snapshots", async ({page}) => {
  let quote = {contract:{symbol:"TEST"},observedAt:new Date().toISOString(),executable:true,error:null as string|null,quote:{bid:99.98,ask:100.02}};
  await page.route("**/v1/ibkr/paper/quote/*", r => r.fulfill({json:quote}));
  await signIn(page); await savePlan(page);
  await page.getByRole("button",{name:"Short",exact:true}).click();
  await page.getByRole("button",{name:"Use bid in draft"}).click();
  await expect(page.getByLabel("Captured planning entry price")).toHaveValue("99.98");
  await expect(page.getByLabel("Entry price cap")).toHaveValue("99.98");
  for (const observedAt of ["not-a-time", new Date(Date.now()-60000).toISOString()]) {
    quote = {...quote, observedAt, quote:{bid:101,ask:102}};
    await page.getByRole("button",{name:"Use bid in draft"}).click();
    await expect(page.getByRole("region",{name:"Executable broker quote"}).getByRole("alert")).toContainText("Fresh executable quote unavailable");
    await expect(page.getByLabel("Captured planning entry price")).toHaveValue("99.98");
  }
  quote = {...quote,observedAt:new Date().toISOString(),executable:false,error:"Market data unavailable (10197)."};
  await page.getByRole("button",{name:"Refresh bid / ask"}).click();
  await expect(page.getByRole("region",{name:"Executable broker quote"}).getByRole("alert")).toContainText("10197");
});

test("changing symbol while a quote is pending cannot apply the previous symbol's price", async ({page}) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => {release=resolve;});
  await page.route("**/v1/ibkr/paper/quote/*", async r => {
    await pending;
    await r.fulfill({json:{contract:{symbol:"TEST"},observedAt:new Date().toISOString(),executable:true,error:null,quote:{bid:101,ask:102}}});
  });
  await signIn(page); await savePlan(page);
  await page.getByRole("button",{name:"Use ask in draft"}).click();
  await expect(page.getByRole("button",{name:"Refreshing…"})).toBeDisabled();
  await page.getByLabel("Stock symbol",{exact:true}).fill("OTHER");
  release();
  await expect(page.getByRole("region",{name:"Executable broker quote"}).getByRole("alert")).toContainText("Symbol or side changed");
  await expect(page.getByLabel("Captured planning entry price")).not.toHaveValue("102");
});


test("failed startup connection retains recorded account evidence and accurate Journal empty state", async ({ page }) => {
  await page.route("**/v1/ibkr/paper/connect", r => r.fulfill({status:409,json:{detail:"TWS is unavailable"}}));
  await signIn(page, {...empty,connected:false,broker:{mode:"read-only",source:"IBKR TWS",connectionStatus:"disconnected",dataStatus:"stale",lastSuccessfulUpdate:"2026-09-17T12:00:00Z",error:null,account:{id:"fixture",maskedId:"DU••10",value:12345,currency:"USD",source:"IBKR accountSummary",observedAt:"2026-09-17T12:00:00Z",available:true},positions:[],openOrders:[]}});
  await expect(page.getByText("TWS is unavailable",{exact:true})).toBeVisible();
  await expect(page.getByText("12,345 USD · Stale",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Journal",exact:true}).click();
  await expect(page.getByText("Local paper records are unavailable.",{exact:false})).toHaveCount(0);
  await expect(page.getByText("No records yet",{exact:true})).toBeVisible();
});

test("ordinary planner saves account-scoped records without replacing legacy data", async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => localStorage.setItem("journal.trade-planner.draft.v1", JSON.stringify({symbol:"LEGACY"})));
  await savePlan(page);
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith("journal.trade-planner.draft.v1")));
  expect(keys.some(k=>k.includes("scope:paper:") && k.endsWith(":test-binding"))).toBe(true);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("journal.trade-planner.draft.v1")!).symbol)).toBe("LEGACY");
  await expect(page.getByRole("region",{name:"Quick trade actions"}).getByRole("button",{name:"Review order",exact:true})).toBeVisible();
  await expect(page.getByText("TWS paper execution",{exact:true})).toHaveCount(0);
});
