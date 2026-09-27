import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import syntheticHistory from "../fixtures/synthetic-journal-v1.json";

async function serveBothViews(page: Page, canHideTrading = true) {
  await page.route("**/v1/local/modules", route => route.fulfill({ json: {
    enabledViews: ["trading", "journal"], canHideTrading, executionEnabled: false,
  } }));
  await page.route("**/v1/local/paper-reference", route => {
    expect(route.request().method()).toBe("GET");
    expect(route.request().headers()["x-brontide-local"]).toBe("1");
    expect(route.request().headers()["x-brontide-csrf"]).toBeTruthy();
    return route.fulfill({ json: { recorded: false, accountMask: null,
      environment: null, paperIdentityVerified: false, executionEnabled: false } });
  });
}

test("confirmed local account shows recorded Journal history without sample trades or broker requests", async ({ page }) => {
  const unexpected: string[] = [];
  let planScopeId = "a".repeat(64);
  const recorded = structuredClone(syntheticHistory) as unknown as Record<string, unknown>;
  recorded.source = "recorded-local-ledger";
  recorded.scopeId = planScopeId;
  const campaigns = recorded.journalCampaigns as Array<Record<string, unknown>>;
  campaigns[0].syntheticOnly = false;
  campaigns[0].accountBinding = "a".repeat(64);
  (campaigns[0].executions as Array<Record<string, unknown>>)[1].role = "cleanup";
  const records = recorded.records as Array<Record<string, unknown>>;
  records[0].id = "recorded:campaign-1";
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/local/session/status") {
      await route.fulfill({ json: { profileId: "local-fixture", authenticated: true,
        brokerAccount: null, environment: null, executionEnabled: false, csrf: "fixture-csrf" } });
      return;
    }
    if (url.pathname === "/v1/local/profile") {
      await route.fulfill({ json: { profileId: "local-fixture", selectedView: "journal",
        brokerAccount: null, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/profile/view") {
      await route.fulfill({ json: { selectedView: route.request().postDataJSON().view, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/binding") {
      await route.fulfill({ json: { remembered: true, environment: "paper", accountMask: "U1••••56",
        connectionVerified: false, reconciliationRequired: true, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/journal/recorded") {
      await route.fulfill({ json: recorded });
      return;
    }
    if (url.pathname === "/v1/local/plans/status") {
      await route.fulfill({ json: { scopeId: planScopeId, hasSavedPlan: false,
        environment: "paper", executionEnabled: false, reviewEligible: false } });
      return;
    }
    if (url.pathname === "/v1/local/plans/current") {
      await route.fulfill({ status: 404, json: { detail: "No saved plan" } });
      return;
    }
    if (url.pathname.startsWith("/v1/chart/")) {
      await route.fulfill({ status: 503, json: { detail: "No local chart fixture" } });
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
      unexpected.push(`${route.request().method()} ${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected service call" } });
      return;
    }
    await route.continue();
  });
  await serveBothViews(page, false);
  await page.goto("/standalone/");
  await expect(page.getByRole("heading", { name: "Trading journal" })).toBeVisible();
  await expect(page.getByText("Recorded paper history · disconnected")).toBeVisible();
  await expect(page.getByText("TWS is disconnected here", { exact: false })).toBeVisible();
  await expect(page.locator('[data-journal-trade-id="recorded:campaign-1"]')).toBeVisible();
  await expect(page.locator('[data-journal-trade-id="journal-amd"]')).toHaveCount(0);
  await page.locator('[data-journal-trade-id="recorded:campaign-1"] button').click();
  await expect(page.getByText("RECORDED IBKR PAPER HISTORY · LAST KNOWN", { exact: true })).toBeVisible();
  await expect(page.locator('.journal-detail-grid span').filter({ hasText: 'Actual weighted entry' })).toContainText('$100.00');
  await expect(page.locator('.journal-detail-grid span').filter({ hasText: 'Gross / costs / net' })).toContainText('+$2.00 / provisional / Unavailable');
  await expect(page.getByText("Personal review editing for saved paper trades is not available yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save review" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log trade" })).toBeDisabled();
  await page.getByRole("button", { name: "Plan & Position", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recorded paper positions" })).toBeVisible();
  await expect(page.getByText("Saved paper executions. Current broker exposure and protection are unverified.")).toBeVisible();
  await expect(page.getByText("Paper account draft · saved privately only after confirmation.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Validate paper intent" })).toHaveCount(0);
  const position = page.locator('[data-recorded-position-id="recorded:campaign-1"]');
  await expect(position).toBeVisible();
  await expect(position).toContainText("Recorded entered");
  await expect(position).toContainText("Recorded remaining");
  await expect(position).toContainText("Current broker position, orders and stop protection are unverified.");
  await expect(page.getByText("Working entries", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Plan & Position", exact: true }).click();
  await expect(position).toBeVisible();
  await position.getByRole("button", { name: "Open in Journal" }).click();
  await expect(page.locator('[data-journal-trade-id="recorded:campaign-1"]')).toBeVisible();
  planScopeId = "b".repeat(64);
  await page.getByRole("button", { name: "Plan & Position", exact: true }).click();
  await expect(page.getByText("Recorded position history is unavailable.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Private paper plan locked" })).toBeVisible();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save plan", exact: true })).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test("ordinary Save plan writes only to the verified private paper scope", async ({ page }) => {
  const unexpected: string[] = [];
  const savedRequests: Array<Record<string, unknown>> = [];
  const scopeId = "a".repeat(64);
  let planScopeId = scopeId;
  const recorded = structuredClone(syntheticHistory) as unknown as Record<string, unknown>;
  recorded.source = "recorded-local-ledger";
  recorded.scopeId = scopeId;
  const campaigns = recorded.journalCampaigns as Array<Record<string, unknown>>;
  campaigns[0].syntheticOnly = false;
  campaigns[0].accountBinding = scopeId;
  (recorded.records as Array<Record<string, unknown>>)[0].id = "recorded:campaign-1";
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/local/session/status") {
      await route.fulfill({ json: { profileId: "local-fixture", authenticated: true,
        brokerAccount: null, environment: null, executionEnabled: false, csrf: "fixture-csrf" } });
      return;
    }
    if (url.pathname === "/v1/local/profile") {
      await route.fulfill({ json: { profileId: "local-fixture", selectedView: "trading",
        brokerAccount: null, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/profile/view") {
      await route.fulfill({ json: { selectedView: route.request().postDataJSON().view, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/binding") {
      await route.fulfill({ json: { remembered: true, environment: "paper", accountMask: "U1••••56",
        connectionVerified: false, reconciliationRequired: true, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/journal/recorded") {
      await route.fulfill({ json: recorded });
      return;
    }
    if (url.pathname === "/v1/local/plans/status") {
      await route.fulfill({ json: { scopeId: planScopeId, hasSavedPlan: savedRequests.length > 0,
        environment: "paper", executionEnabled: false, reviewEligible: false } });
      return;
    }
    if (url.pathname === "/v1/local/plans/current") {
      await route.fulfill({ status: 404, json: { detail: "No saved plan" } });
      return;
    }
    if (url.pathname === "/v1/local/plans" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      savedRequests.push(body);
      const plan = body.savedPlan as Record<string, unknown>;
      await route.fulfill({ json: { scopeId, planId: plan.planId,
        planRevision: plan.planRevision, contentDigest: "b".repeat(64),
        executionEnabled: false, reviewEligible: false } });
      return;
    }
    if (url.pathname.startsWith("/v1/chart/")) {
      await route.fulfill({ status: 503, json: { detail: "No local chart fixture" } });
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") ||
        url.hostname.endsWith("supabase.co")) {
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected service call" } });
      return;
    }
    await route.continue();
  });
  await serveBothViews(page, false);
  await page.goto("/standalone/");
  await expect(page.getByRole("heading", { name: "Trade planner" })).toBeVisible();
  await expect(page.getByText("Paper account draft · saved privately only after confirmation.", { exact: false })).toBeVisible();
  await page.getByLabel("Stop method").selectOption("Manual");
  await page.getByLabel("Captured planning entry price").fill("100");
  await page.getByLabel("Stop price").fill("99");
  await page.getByLabel("Requested shares").fill("3");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(page.getByText("Plan saved in this paper account's private records.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit plan" })).toBeVisible();
  expect(savedRequests).toHaveLength(1);
  expect(savedRequests[0].expectedScopeId).toBe(scopeId);
  expect(savedRequests[0].expectedRevision).toBeNull();
  const plan = savedRequests[0].savedPlan as Record<string, unknown>;
  expect(plan.symbol).toBe("NVDA");
  expect(plan.executionQuantity).toBe(3);
  expect((plan.capturedEntrySource as Record<string, unknown>).source).toBe("Manual");
  expect(plan).not.toHaveProperty("origin");
  await page.getByRole("button", { name: "Edit exits" }).click();
  await page.getByLabel("Breakeven activation").selectOption("2");
  await page.getByRole("button", { name: "Save exits", exact: true }).click();
  await expect(page.getByText("Exit-plan revision saved privately.", { exact: false })).toBeVisible();
  expect(savedRequests).toHaveLength(2);
  expect(savedRequests[1].expectedRevision).toBe(plan.planRevision);
  const exits = (savedRequests[1].savedPlan as Record<string, unknown>).exitPlan as Record<string, unknown>;
  expect((exits.breakeven as Record<string, unknown>).activationR).toBe(2);
  await page.getByRole("button", { name: "Edit plan" }).click();
  await expect(page.getByText("Current fields are unsaved.", { exact: false })).toBeVisible();
  await page.getByLabel("Stock symbol", { exact: true }).fill("MSFT");
  await page.getByRole("navigation", { name: "Trading views" }).getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("button", { name: "Plan & Position", exact: true }).click();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toHaveValue("MSFT");
  planScopeId = "b".repeat(64);
  await page.getByRole("navigation", { name: "Trading views" }).getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("button", { name: "Plan & Position", exact: true }).click();
  await expect(page.getByText("Recorded position history is unavailable.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Private paper plan locked" })).toBeVisible();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save plan", exact: true })).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test("a confirmed account with unreadable history never falls back to sample records or zero exposure", async ({ page }) => {
  const unexpected: string[] = [];
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/local/session/status") {
      await route.fulfill({ json: { profileId: "local-fixture", authenticated: true,
        brokerAccount: null, environment: null, executionEnabled: false, csrf: "fixture-csrf" } });
      return;
    }
    if (url.pathname === "/v1/local/profile") {
      await route.fulfill({ json: { profileId: "local-fixture", selectedView: "journal",
        brokerAccount: null, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/profile/view") {
      await route.fulfill({ json: { selectedView: route.request().postDataJSON().view, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/binding") {
      await route.fulfill({ json: { remembered: true, environment: "paper", accountMask: "U1••••56",
        connectionVerified: false, reconciliationRequired: true, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/journal/recorded") {
      await route.fulfill({ status: 503, json: { detail: "History unavailable" } });
      return;
    }
    if (url.pathname.startsWith("/v1/chart/")) {
      await route.fulfill({ status: 503, json: { detail: "No local chart fixture" } });
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
      unexpected.push(`${route.request().method()} ${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected service call" } });
      return;
    }
    await route.continue();
  });
  await serveBothViews(page, false);
  await page.goto("/standalone/");
  await expect(page.getByRole("alert").filter({ hasText: "Recorded history unavailable" })).toBeVisible();
  await expect(page.getByText("No sample records or zero exposure are substituted.")).toBeVisible();
  await expect(page.locator('[data-journal-trade-id]')).toHaveCount(0);
  await expect(page.getByText("No records yet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log trade" })).toBeDisabled();
  await page.getByRole("button", { name: "Plan & Position", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Recorded position history is unavailable" })).toBeVisible();
  await expect(page.locator('[data-recorded-position-id]')).toHaveCount(0);
  await expect(page.getByText("No sample positions or zero broker exposure are substituted.", { exact: false })).toBeVisible();
  await expect(page.getByText("Saved paper executions. Current broker exposure and protection are unverified.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Private paper plan locked" })).toBeVisible();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save plan", exact: true })).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test("Connect shows only a remembered paper-account mask and keeps orders locked", async ({ page }) => {
  const unexpected: string[] = [];
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/local/session/status") {
      await route.fulfill({ json: { profileId: "local-fixture", authenticated: true,
        brokerAccount: null, environment: null, executionEnabled: false, csrf: "fixture-csrf" } });
      return;
    }
    if (url.pathname === "/v1/local/profile") {
      await route.fulfill({ json: { profileId: "local-fixture", selectedView: "connect",
        brokerAccount: null, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/profile/view") {
      await route.fulfill({ json: { selectedView: route.request().postDataJSON().view, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/binding") {
      await route.fulfill({ json: { remembered: true, environment: "paper", accountMask: "U1••••56",
        connectionVerified: false, reconciliationRequired: true, executionEnabled: false } });
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
      unexpected.push(`${route.request().method()} ${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected service call" } });
      return;
    }
    await route.continue();
  });
  await serveBothViews(page, false);
  await page.route("**/v1/local/paper-reference", route => route.fulfill({
    status: 409, json: { detail: "Private paper reference is unavailable." },
  }));
  await page.goto("/standalone/");
  const readiness = page.getByRole("region", { name: "Connection readiness" });
  await expect(readiness).toContainText("Paper choice U1••••56 · disconnected");
  await expect(readiness).toContainText("not proof of a current TWS connection");
  await expect(page.getByRole("region", { name: "Record your paper account" }))
    .toContainText("private paper reference could not be checked");
  await expect(page.getByRole("button", { name: "Record private paper reference" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Execution status" })).toContainText("Order submission locked");
  expect(unexpected).toEqual([]);
});

test("Connect records only an independently checked paper reference and keeps trading locked", async ({ page }) => {
  const unexpected: string[] = [];
  let recorded = false;
  let writes = 0;
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/local/session/status") {
      await route.fulfill({ json: { profileId: "local-fixture", authenticated: true,
        brokerAccount: null, environment: null, executionEnabled: false, csrf: "fixture-csrf" } });
      return;
    }
    if (url.pathname === "/v1/local/profile/view") {
      expect(request.method()).toBe("PUT");
      expect(request.headers()["x-brontide-csrf"]).toBe("fixture-csrf");
      await route.fulfill({ json: { selectedView: request.postDataJSON().view, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/profile") {
      await route.fulfill({ json: { profileId: "local-fixture", selectedView: "connect",
        brokerAccount: null, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/binding") {
      await route.fulfill({ json: { remembered: false, environment: null, accountMask: null,
        connectionVerified: false, reconciliationRequired: true, executionEnabled: false } });
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected service call" } });
      return;
    }
    await route.continue();
  });
  await serveBothViews(page);
  await page.route("**/v1/local/paper-reference", async route => {
    const request = route.request();
    expect(request.headers()["x-brontide-local"]).toBe("1");
    expect(request.headers()["x-brontide-csrf"]).toBe("fixture-csrf");
    if (request.method() === "POST") {
      writes += 1;
      expect(request.postDataJSON()).toEqual({ typedAccount: "DU654321",
        repeatedAccount: "DU654321", checkedInIbkrPaper: true });
      recorded = true;
    } else expect(request.method()).toBe("GET");
    await route.fulfill({ json: { recorded, accountMask: recorded ? "DU••••21" : null,
      environment: recorded ? "paper" : null,
      paperIdentityVerified: false, executionEnabled: false } });
  });
  await page.goto("/standalone/");
  const reference = page.getByRole("region", { name: "Record your paper account" });
  await expect(reference).toBeVisible();
  const record = reference.getByRole("button", { name: "Record private paper reference" });
  await expect(record).toBeDisabled();
  await reference.getByRole("textbox", { name: "Paper account ID checked in IBKR" }).fill("DU654321");
  await reference.getByRole("textbox", { name: "Enter the same paper account ID again" }).fill("DU123456");
  await reference.getByRole("checkbox", { name: /I checked this exact ID/ }).check();
  await expect(record).toBeDisabled();
  await reference.getByRole("textbox", { name: "Enter the same paper account ID again" }).fill("DU654321");
  await record.click();
  await expect(reference).toContainText("Private reference: DU••••21");
  await expect(reference.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Find accounts in TWS" })).toHaveCount(0);
  await expect(page.getByText("Broker account review is unavailable in this installed app.", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "Execution status" })).toContainText("Order submission locked");
  await page.reload();
  await expect(reference).toContainText("Private reference: DU••••21");
  expect(writes).toBe(1);
  expect(unexpected).toEqual([]);
});

test("an uncertain paper-reference save requires a read-only status check before another attempt", async ({ page }) => {
  const unexpected: string[] = [];
  let recorded = false;
  let writes = 0;
  let reads = 0;
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/local/session/status") {
      await route.fulfill({ json: { profileId: "local-fixture", authenticated: true,
        brokerAccount: null, environment: null, executionEnabled: false, csrf: "fixture-csrf" } });
      return;
    }
    if (url.pathname === "/v1/local/profile/view") {
      expect(request.method()).toBe("PUT");
      expect(request.headers()["x-brontide-csrf"]).toBe("fixture-csrf");
      await route.fulfill({ json: { selectedView: request.postDataJSON().view, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/profile") {
      await route.fulfill({ json: { profileId: "local-fixture", selectedView: "connect",
        brokerAccount: null, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/binding") {
      await route.fulfill({ json: { remembered: false, environment: null, accountMask: null,
        connectionVerified: false, reconciliationRequired: true, executionEnabled: false } });
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected service call" } });
      return;
    }
    await route.continue();
  });
  await serveBothViews(page);
  await page.route("**/v1/local/paper-reference", async route => {
    const request = route.request();
    expect(request.headers()["x-brontide-csrf"]).toBe("fixture-csrf");
    if (request.method() === "POST") {
      writes += 1;
      expect(request.postDataJSON()).toEqual({ typedAccount: "DU654321",
        repeatedAccount: "DU654321", checkedInIbkrPaper: true });
      recorded = true;
      await route.fulfill({ status: 503, json: { detail: "Acknowledgement lost" } });
      return;
    }
    expect(request.method()).toBe("GET");
    reads += 1;
    await route.fulfill({ json: { recorded, accountMask: recorded ? "DU••••21" : null,
      environment: recorded ? "paper" : null,
      paperIdentityVerified: false, executionEnabled: false } });
  });
  await page.goto("/standalone/");
  const reference = page.getByRole("region", { name: "Record your paper account" });
  await reference.getByRole("textbox", { name: "Paper account ID checked in IBKR" }).fill("DU654321");
  await reference.getByRole("textbox", { name: "Enter the same paper account ID again" }).fill("DU654321");
  await reference.getByRole("checkbox", { name: /I checked this exact ID/ }).check();
  await reference.getByRole("button", { name: "Record private paper reference" }).click();
  await expect(reference.getByRole("alert")).toContainText("save result is uncertain");
  await expect(reference.getByRole("button", { name: "Record private paper reference" })).toHaveCount(0);
  expect(writes).toBe(1);
  expect(reads).toBe(1);
  await reference.getByRole("button", { name: "Check saved reference" }).click();
  await expect(reference).toContainText("Private reference: DU••••21");
  expect(reads).toBe(2);
  expect(writes).toBe(1);
  expect(unexpected).toEqual([]);
});

test("ordinary Connect reviews masked accounts and checks an uncertain confirmation without retrying", async ({ page }) => {
  let remembered = false;
  let reviews = 0;
  let confirmations = 0;
  let exactChecks = 0;
  let bindingReads = 0;
  const unexpected: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/local/session/status") {
      await route.fulfill({ json: { profileId: "local-fixture", authenticated: true,
        brokerAccount: null, environment: null, executionEnabled: false, csrf: "fixture-csrf" } });
      return;
    }
    if (url.pathname === "/v1/local/profile" && request.method() === "GET") {
      await route.fulfill({ json: { profileId: "local-fixture", selectedView: "connect",
        brokerAccount: null, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/profile/view") {
      await route.fulfill({ json: { selectedView: route.request().postDataJSON().view, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/binding/check" && request.method() === "POST") {
      exactChecks += 1;
      expect(request.headers()["x-brontide-csrf"]).toBe("fixture-csrf");
      expect(request.postDataJSON()).toEqual({ typedAccount: "DU123456" });
      await route.fulfill({ json: { remembered: true, exactMatch: true,
        connectionVerified: false, reconciliationRequired: true, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/binding") {
      bindingReads += 1;
      await route.fulfill({ json: { remembered, environment: remembered ? "paper" : null,
        accountMask: remembered ? "DU••••56" : null, connectionVerified: false,
        reconciliationRequired: true, executionEnabled: false,
        accountSelectionAvailable: true } });
      return;
    }
    if (url.pathname === "/v1/local/account-selection" && request.method() === "POST") {
      reviews += 1;
      expect(request.headers()["x-brontide-csrf"]).toBe("fixture-csrf");
      await route.fulfill({ json: { selectionId: "a".repeat(32),
        candidates: [{ index: 0, mask: "DU••••21" }, { index: 1, mask: "DU••••56" }],
        paperIdentityVerified: false, reconciliationRequired: true,
        executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/account-selection/confirm" && request.method() === "POST") {
      confirmations += 1;
      expect(request.postDataJSON()).toEqual({ selectionId: "a".repeat(32),
        index: 1, typedAccount: "DU123456" });
      remembered = true;
      await route.fulfill({ status: 503, json: { detail: "Acknowledgement lost" } });
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected service call" } });
      return;
    }
    await route.continue();
  });
  await serveBothViews(page);
  await page.route("**/v1/local/paper-reference", route => route.fulfill({ json: {
    recorded: true, accountMask: "DU••••56", environment: "paper",
    paperIdentityVerified: false, executionEnabled: false,
  } }));
  await page.goto("/standalone/");
  const review = page.getByRole("region", { name: "Review a TWS paper account" });
  await expect(review).toBeVisible();
  expect(reviews).toBe(0);
  await review.getByRole("button", { name: "Find accounts in TWS" }).click();
  await expect(review.getByRole("combobox", { name: "Masked account seen by TWS" })).toBeVisible();
  await expect(review).toContainText("Different accounts can share one mask");
  await expect(review.getByRole("option", { name: /same visible mask, exact ID not yet checked/ })).toHaveCount(1);
  const confirm = review.getByRole("button", { name: "Confirm paper account choice" });
  await review.getByRole("combobox", { name: "Masked account seen by TWS" }).selectOption("0");
  await review.getByRole("textbox", { name: /Type the full account ID/ }).fill("DU654321");
  await expect(confirm).toBeDisabled();
  await review.getByRole("combobox", { name: "Masked account seen by TWS" }).selectOption("1");
  await review.getByRole("textbox", { name: /Type the full account ID/ }).fill("DU123456");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(review.getByRole("alert")).toContainText("result is uncertain");
  await expect(review.getByRole("button", { name: "Confirm paper account choice" })).toHaveCount(0);
  expect(confirmations).toBe(1);
  await review.getByRole("button", { name: "Check saved choice" }).click();
  await expect(page.getByRole("region", { name: "Connection readiness" }))
    .toContainText("Paper choice DU••••56 · disconnected");
  await expect(page.getByRole("region", { name: "Execution status" }))
    .toContainText("Order submission locked");
  expect(reviews).toBe(1);
  expect(confirmations).toBe(1);
  expect(exactChecks).toBe(1);
  expect(bindingReads).toBeGreaterThanOrEqual(1);
  expect(unexpected).toEqual([]);
});

test("standalone sample storage stays separate from legacy demo drafts, reviews and campaigns", async ({ page }) => {
  const unexpected: string[] = [];
  let inStandalone = false;
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/local/session/status") {
      await route.fulfill({ status: 401, json: { detail: "Sample preview" } });
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
      if (inStandalone) unexpected.push(`${route.request().method()} ${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected service call" } });
      return;
    }
    await route.continue();
  });

  await page.goto("/?demo=1");
  const legacy = await page.evaluate(() => {
    const values = {
      "brontide-demo-review:journal.trade-planner.draft.v1": JSON.stringify({
        symbol: "LEGACY", side: "Long", entryPrice: 100, stopPrice: 96.25,
        stopSource: "LoD", accountEquity: 30000, riskPercent: 0.5,
        maxAllocationPercent: 20, savedAt: "2026-09-01T12:00:00Z",
      }),
      "brontide-demo-review:brontide-position-campaigns-v1": "[]",
      "brontide-demo-review:brontide-journal-campaigns-v1": "[]",
      "brontide-demo-review:brontide-journal-reviews-v1": "{}",
      "brontide.ui.v1.demo.journal-statistics": "true",
      "journal-trades-v2": "legacy-local-trade-backup",
    };
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
    return values;
  });
  await page.addInitScript(() => {
    const reads: string[] = [];
    const writes: string[] = [];
    Object.assign(window, { __sampleStorageReads: reads, __sampleStorageWrites: writes });
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    const removeItem = Storage.prototype.removeItem;
    Storage.prototype.getItem = function (key: string) {
      reads.push(key);
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key: string, value: string) {
      writes.push(key);
      return setItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key: string) {
      writes.push(key);
      return removeItem.call(this, key);
    };
  });

  inStandalone = true;
  await page.goto("/standalone/");
  await expect(page.getByRole("region", { name: "Execution status" })).toContainText("Order submission locked");
  await page.getByRole("button", { name: "Explore Trading with sample data" }).click();
  await expect(page.getByLabel("Stock symbol", { exact: true })).not.toHaveValue("LEGACY");
  await page.getByLabel("Stock symbol", { exact: true }).fill("NVDA");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(page.getByText("Saved locally. Broker validation has not run and no order was submitted.")).toBeVisible();
  await page.getByRole("navigation", { name: "Trading views" }).getByRole("button", { name: "Journal" }).click();
  await page.getByRole("button", { name: "More statistics" }).click();
  await page.locator('[data-journal-trade-id="journal-amd"] button').click();
  await page.getByLabel("AMD One lesson").fill("Standalone sample review.");
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText("Review saved locally", { exact: true })).toBeVisible();
  const standaloneStorage = await page.evaluate(() => {
    const capture = window as unknown as { __sampleStorageReads: string[]; __sampleStorageWrites: string[] };
    return {
      reads: [...capture.__sampleStorageReads],
      writes: [...capture.__sampleStorageWrites],
      draft: localStorage.getItem("brontide-standalone-sample-v1:anonymous-preview:journal.trade-planner.draft.v1"),
      review: localStorage.getItem("brontide-standalone-sample-v1:anonymous-preview:brontide-journal-reviews-v1"),
    };
  });
  expect(standaloneStorage.draft).toContain('"symbol":"NVDA"');
  expect(standaloneStorage.review).toContain("Standalone sample review.");
  expect(standaloneStorage.reads).toContain("brontide-standalone-sample-v1:anonymous-preview:brontide-position-campaigns-v1");
  expect(standaloneStorage.reads).toContain("brontide-standalone-sample-v1:anonymous-preview:brontide-journal-campaigns-v1");
  expect(standaloneStorage.writes).toContain("brontide.ui.v1.standalone-sample-v1:anonymous-preview.journal-statistics");
  expect([...standaloneStorage.reads, ...standaloneStorage.writes].filter(key =>
    key.startsWith("brontide-demo-review:") || key.startsWith("brontide.ui.v1.demo.") || key === "journal-trades-v2",
  )).toEqual([]);
  expect(unexpected).toEqual([]);

  inStandalone = false;
  await page.goto("/?demo=1");
  const navigation = page.getByRole("button", { name: "Workspace navigation" });
  await navigation.click();
  await page.getByRole("button", { name: "Trading", exact: true }).click();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toHaveValue("LEGACY");
  const preserved = await page.evaluate(keys => Object.fromEntries(
    Object.keys(keys).map(key => [key, localStorage.getItem(key)]),
  ), legacy);
  expect(preserved).toEqual(legacy);
  await page.evaluate(() => {
    const key = "brontide-demo-review:journal.trade-planner.draft.v1";
    const draft = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...draft, symbol: "AAPL" }));
  });
  await page.reload();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toHaveValue("AAPL");
  inStandalone = true;
  await page.goto("/standalone/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Trading" }).click();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toHaveValue("NVDA");
  await expect(page.getByRole("button", { name: "Submit paper order" })).toBeDisabled();
  expect(unexpected).toEqual([]);
});

test("standalone sample drafts and Journal reviews follow the verified profile and leave anonymous preview separate", async ({ page }) => {
  let profile = "fixture-profile-A";
  let revokeViewWrite = false;
  let anonymous = false;
  const unexpected: string[] = [];
  const viewWrites: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/local/session/status") {
      if (anonymous) { await route.fulfill({ status: 401, json: { detail: "Anonymous preview" } }); return; }
      await route.fulfill({ json: { profileId: profile, authenticated: true, brokerAccount: null,
        environment: null, executionEnabled: false, csrf: `${profile}-csrf` } });
      return;
    }
    if (url.pathname === "/v1/local/profile" && request.method() === "GET") {
      await route.fulfill({ json: { profileId: profile, selectedView: "connect", brokerAccount: null, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/profile/view" && request.method() === "PUT") {
      viewWrites.push((request.postDataJSON() as { view: string }).view);
      if (revokeViewWrite) {
        revokeViewWrite = false;
        await route.fulfill({ status: 401, json: { detail: "Expired local session" } });
      } else {
        await route.fulfill({ json: { selectedView: viewWrites.at(-1), executionEnabled: false } });
      }
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
      unexpected.push(`${request.method()} ${url.hostname}${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected service call" } });
      return;
    }
    await route.continue();
  });

  const connect = page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Connect" });
  const trading = page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Trading" });
  const journal = page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Journal" });
  await page.route("**/v1/local/binding", route => route.fulfill({ json: {
    remembered: false, environment: null, accountMask: null,
    connectionVerified: false, reconciliationRequired: true, executionEnabled: false,
  } }));
  const verified = async () => {
    await expect(page.getByRole("heading", { name: "Connect to Interactive Brokers" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Connection readiness" })).toContainText("Checked at launch · sample only");
  };
  await serveBothViews(page);
  await page.goto("/standalone/");
  await verified();
  await page.evaluate(() => localStorage.setItem(
    "brontide-standalone-sample-v1:profile:fixture-profile-A:journal.trade-planner.draft.v1",
    JSON.stringify({ symbol: "AAPL", side: "Long", entryPrice: 100, stopPrice: 96.25,
      stopSource: "LoD", accountEquity: 30000, riskPercent: 0.5,
      maxAllocationPercent: 20, savedAt: "2026-09-01T12:00:00Z" }),
  ));
  await page.reload();
  await verified();
  await page.getByRole("button", { name: "Explore Trading with sample data" }).click();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toHaveValue("AAPL");
  await journal.click();
  await page.locator('[data-journal-trade-id="journal-amd"] button').click();
  await page.getByLabel("AMD One lesson").fill("Profile A saved.");
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText("Review saved locally", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Log trade" }).click();
  const logTrade = page.getByRole("dialog", { name: "Log a trade" });
  await logTrade.getByLabel("Symbol").fill("AONLY");
  await logTrade.getByLabel("Dollar risk").fill("10");
  await logTrade.getByLabel("Planned reward").fill("1");
  await logTrade.getByLabel("Final P&L").fill("5");
  await logTrade.getByRole("button", { name: "Save trade" }).click();
  await expect(page.getByRole("button", { name: "AONLY" })).toBeVisible();
  await page.getByLabel("AMD One lesson").fill("Profile A unsaved.");
  await expect.poll(() => viewWrites.at(-1)).toBe("journal");
  revokeViewWrite = true;
  await trading.click();
  await connect.click();
  await expect(page.getByRole("region", { name: "Connection readiness" })).toContainText("Sample mode");
  await expect(page.getByRole("region", { name: "Execution status" })).toContainText("Order submission locked");
  await expect(page.getByRole("button", { name: "Explore Journal" })).toHaveCount(0);
  anonymous = true;
  await page.reload();
  await page.getByRole("button", { name: "Explore Journal" }).click();
  await page.locator('[data-journal-trade-id="journal-amd"] button').click();
  await expect(page.getByLabel("AMD One lesson")).toHaveValue("");
  await expect(page.getByRole("button", { name: "AONLY" })).toHaveCount(0);

  anonymous = false;
  profile = "fixture-profile-B";
  await page.reload();
  await verified();
  await page.getByRole("button", { name: "Explore Trading with sample data" }).click();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toHaveValue("NVDA");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await journal.click();
  await page.locator('[data-journal-trade-id="journal-amd"] button').click();
  await expect(page.getByLabel("AMD One lesson")).toHaveValue("");
  await page.getByLabel("AMD One lesson").fill("Profile B saved.");
  await page.getByRole("button", { name: "Save review" }).click();
  await page.reload();
  await verified();
  await page.getByRole("button", { name: "Explore Journal" }).click();
  await page.locator('[data-journal-trade-id="journal-amd"] button').click();
  await expect(page.getByLabel("AMD One lesson")).toHaveValue("Profile B saved.");

  profile = "fixture-profile-A";
  await page.reload();
  await verified();
  await page.getByRole("button", { name: "Explore Trading with sample data" }).click();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toHaveValue("AAPL");
  await journal.click();
  await page.locator('[data-journal-trade-id="journal-amd"] button').click();
  await expect(page.getByLabel("AMD One lesson")).toHaveValue("Profile A saved.");
  expect(unexpected).toEqual([]);
});

test("standalone Trading and Journal share the existing draft without unrelated service calls", async ({ page }) => {
  const serviceCalls: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/local/session/status") {
      await route.fulfill({ status: 401, json: { detail: "Sample preview" } });
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
      serviceCalls.push(`${route.request().method()} ${url.hostname}${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected service call in standalone sample mode" } });
      return;
    }
    await route.continue();
  });

  await page.goto("/standalone/");
  await expect(page.getByRole("complementary", { name: "Standalone preview status" })).toContainText("Trading module preview");
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Connect to Interactive Brokers" })).toBeVisible();
  await page.getByRole("button", { name: "Explore Trading with sample data" }).click();
  await expect(page.getByRole("button", { name: "Plan & Position", exact: true })).toBeVisible();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toBeVisible();
  await page.getByLabel("Stock symbol", { exact: true }).fill("DRAFTSAFE");
  await page.getByLabel("Captured planning entry price").fill("123.45");

  await page.getByRole("navigation", { name: "Trading views" }).getByRole("button", { name: "Journal" }).click();
  await expect(page.getByRole("heading", { name: "Trading journal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scans" })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Trading views" }).getByRole("button", { name: "Plan & Position", exact: true }).click();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toHaveValue("DRAFTSAFE");
  await expect(page.getByLabel("Captured planning entry price")).toHaveValue("123.45");
  expect(serviceCalls).toEqual([]);
});

test("standalone view choice survives reload and remains usable at mobile width", async ({ page }) => {
  await page.route("**/v1/local/session/status", route => route.fulfill({ status: 401, json: { detail: "Anonymous sample preview" } }));
  await page.goto("/standalone/");
  await page.getByRole("button", { name: "Explore Journal" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Trading journal" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "Workspace tabs" }).getByRole("button", { name: "Trading" })).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace tabs" }).getByRole("button", { name: "Trading" }).click();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("authenticated Home saves Trading and Journal visibility without broker requests", async ({ page }) => {
  let enabledViews: ("trading" | "journal")[] = ["trading", "journal"];
  const unexpected: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/local/session/status") {
      await route.fulfill({ json: { profileId: "fixture-profile", authenticated: true,
        brokerAccount: null, environment: null, executionEnabled: false, csrf: "fixture-csrf" } });
      return;
    }
    if (url.pathname === "/v1/local/profile") {
      await route.fulfill({ json: { profileId: "fixture-profile", selectedView: "connect",
        brokerAccount: null, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/profile/view") {
      const view = (request.postDataJSON() as { view: string }).view;
      await route.fulfill({ json: { selectedView: view, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/modules") {
      if (request.method() === "PUT") {
        expect(request.headers()["x-brontide-csrf"]).toBe("fixture-csrf");
        enabledViews = (request.postDataJSON() as { enabledViews: ("trading" | "journal")[] }).enabledViews;
      }
      await route.fulfill({ json: { enabledViews, canHideTrading: true, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/paper-reference") {
      expect(request.method()).toBe("GET");
      expect(request.headers()["x-brontide-csrf"]).toBe("fixture-csrf");
      await route.fulfill({ json: { recorded: false, accountMask: null, environment: null,
        paperIdentityVerified: false, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/binding") {
      await route.fulfill({ json: { remembered: false, environment: null, accountMask: null,
        connectionVerified: false, reconciliationRequired: true, executionEnabled: false } });
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected service request" } });
      return;
    }
    await route.continue();
  });
  await page.goto("/standalone/");
  const home = page.getByRole("region", { name: "Choose your workspace" });
  await expect(home.getByRole("checkbox", { name: "Trading" })).toBeChecked();
  await expect(home.getByRole("checkbox", { name: "Journal" })).toBeChecked();
  await home.getByRole("checkbox", { name: "Journal" }).uncheck();
  await home.getByRole("button", { name: "Save views" }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Journal" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Explore Journal" })).toHaveCount(0);
  await page.reload();
  await expect(home.getByRole("checkbox", { name: "Journal" })).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(home.getByRole("button", { name: "Save views" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record private paper reference" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record private paper reference" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Check local API package" })).toBeVisible();
  const recordReference = page.getByRole("button", { name: "Record private paper reference" });
  await recordReference.evaluate(element => { element.style.fontSize = `${parseFloat(getComputedStyle(element).fontSize) * 2}px`; });
  const enlargedBounds = await recordReference.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const button = element.getBoundingClientRect();
    return { textTop: text.top, textBottom: text.bottom, buttonTop: button.top, buttonBottom: button.bottom };
  });
  expect(enlargedBounds.textTop).toBeGreaterThanOrEqual(enlargedBounds.buttonTop);
  expect(enlargedBounds.textBottom).toBeLessThanOrEqual(enlargedBounds.buttonBottom);
  await recordReference.evaluate(element => { element.style.removeProperty("font-size"); });
  await home.getByRole("checkbox", { name: "Journal" }).check();
  await home.getByRole("checkbox", { name: "Trading" }).uncheck();
  await home.getByRole("button", { name: "Save views" }).click();
  await expect(page.getByRole("navigation", { name: "Workspace tabs" }).getByRole("button", { name: "Trading" })).toHaveCount(0);
  await page.getByRole("button", { name: "Explore Journal" }).click();
  await expect(page.getByRole("heading", { name: "Trading journal" })).toBeVisible();
  expect(unexpected).toEqual([]);
});

test("malformed module status keeps authenticated workspace on Connect only", async ({ page }) => {
  await page.route("**/v1/local/session/status", route => route.fulfill({ json: {
    profileId: "fixture-profile", authenticated: true, brokerAccount: null,
    environment: null, executionEnabled: false, csrf: "fixture-csrf",
  } }));
  await page.route("**/v1/local/profile", route => route.fulfill({ json: {
    profileId: "fixture-profile", selectedView: "trading", brokerAccount: null,
    executionEnabled: false,
  } }));
  await page.route("**/v1/local/modules", route => route.fulfill({ json: {
    enabledViews: ["journal"], canHideTrading: false, executionEnabled: true,
  } }));
  await page.goto("/standalone/");
  await expect(page.getByRole("heading", { name: "Connect to Interactive Brokers" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button")).toHaveCount(1);
  await expect(page.getByText("Saved view choices are unavailable.", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "Execution status" })).toContainText("Order submission locked");
});

test("Connect is a locked first-run guide and makes no broker probe", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/local/session/status") {
      await route.fulfill({ status: 401, json: { detail: "Sample preview" } });
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
      requests.push(`${request.method()} ${url.hostname}${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected request" } });
      return;
    }
    await route.continue();
  });
  await page.goto("/standalone/");
  await expect(page.getByRole("heading", { name: "Connect to Interactive Brokers" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Connection readiness" })).toContainText("Sample mode");
  await expect(page.getByRole("region", { name: "Connection readiness" })).toContainText("Not verified");
  await expect(page.getByRole("region", { name: "Connection readiness" })).toContainText("Not checked");
  await expect(page.getByRole("region", { name: "Execution status" })).toContainText("Order submission locked");
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Official TWS API setup" })).toHaveAttribute("href", "https://www.interactivebrokers.com/campus/trading-lessons/installing-configuring-tws-for-the-api/");
  await expect(page.getByRole("link", { name: "Official API download and license" })).toHaveAttribute("href", "https://interactivebrokers.github.io/");
  expect(requests).toEqual([]);
});

test("Connect reports local SDK metadata only after an explicit check and remains locked", async ({ page }) => {
  const unexpected: string[] = [];
  let metadataCalls = 0;
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/local/session/status") {
      await route.fulfill({ json: { profileId: "fixture-profile", authenticated: true,
        brokerAccount: null, environment: null, executionEnabled: false, csrf: "fixture-csrf" } });
      return;
    }
    if (url.pathname === "/v1/local/profile/view") {
      expect(request.method()).toBe("PUT");
      expect(request.headers()["x-brontide-csrf"]).toBe("fixture-csrf");
      await route.fulfill({ json: { selectedView: request.postDataJSON().view, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/profile" && request.method() === "GET") {
      await route.fulfill({ json: { profileId: "fixture-profile", selectedView: "connect",
        brokerAccount: null, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/sdk/metadata" && request.method() === "GET") {
      expect(request.headers()["x-brontide-local"]).toBe("1");
      metadataCalls += 1;
      if (metadataCalls === 1) {
        await route.fulfill({ json: { metadataStatus: "metadata-present-unverified",
          reportedVersion: "10.50.2", reportedProtobufPin: "5.29.5",
          knownDependencyAdvisory: "GHSA-7gcm-g887-7qv7",
          officialOriginVerified: false, dependencyCompatible: null, executionEnabled: false } });
      } else {
        await route.fulfill({ status: 401, json: { detail: "Expired local session" } });
      }
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected request" } });
      return;
    }
    await route.continue();
  });

  await page.route("**/v1/local/binding", route => route.fulfill({ json: {
    remembered: false, environment: null, accountMask: null,
    connectionVerified: false, reconciliationRequired: true, executionEnabled: false,
  } }));
  await serveBothViews(page);
  await page.goto("/standalone/");
  const readiness = page.getByRole("region", { name: "Connection readiness" });
  await expect(readiness).toContainText("Not verified");
  expect(metadataCalls).toBe(0);
  await page.getByRole("button", { name: "Check local API package" }).click();
  await expect(readiness).toContainText("Known dependency advisory");
  await expect(readiness).toContainText("Package metadata declares protobuf 5.29.5");
  await expect(readiness.getByRole("link", { name: "Read the dependency advisory" }))
    .toHaveAttribute("href", "https://github.com/advisories/GHSA-7gcm-g887-7qv7");
  await expect(page.getByRole("region", { name: "Execution status" })).toContainText("Order submission locked");
  await page.getByRole("button", { name: "Check local API package" }).click();
  await expect(readiness).toContainText("Sample mode");
  await expect(readiness).toContainText("Not verified");
  expect(metadataCalls).toBe(2);
  expect(unexpected).toEqual([]);
});

test("authenticated local profile restores and saves only reviewed views while execution stays locked", async ({ page }) => {
  const writes: string[] = [];
  const unexpected: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/local/session/status") {
      expect(request.headers()["x-brontide-local"]).toBe("1");
      await route.fulfill({ json: { profileId: "fixture-profile", authenticated: true, brokerAccount: null, environment: null, executionEnabled: false, csrf: "fixture-csrf" } });
      return;
    }
    if (url.pathname === "/v1/local/profile" && request.method() === "GET") {
      await route.fulfill({ json: { profileId: "fixture-profile", selectedView: "journal", brokerAccount: null, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/profile/view" && request.method() === "PUT") {
      expect(request.headers()["x-brontide-local"]).toBe("1");
      expect(request.headers()["x-brontide-csrf"]).toBe("fixture-csrf");
      const body = request.postDataJSON() as { view: string };
      expect(["connect", "trading", "journal"]).toContain(body.view);
      writes.push(body.view);
      await route.fulfill({ json: { selectedView: body.view, executionEnabled: false } });
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected service call" } });
      return;
    }
    await route.continue();
  });
  await page.route("**/v1/local/binding", route => route.fulfill({ json: {
    remembered: false, environment: null, accountMask: null,
    connectionVerified: false, reconciliationRequired: true, executionEnabled: false,
  } }));
  await serveBothViews(page);
  await page.goto("/standalone/");
  await expect(page.getByRole("heading", { name: "Trading journal" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("region", { name: "Connection readiness" })).toContainText("Checked at launch · sample only");
  await expect(page.getByRole("region", { name: "Execution status" })).toContainText("Order submission locked");
  await page.getByRole("button", { name: "Explore Trading with sample data" }).click();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toBeVisible();
  await expect.poll(() => writes.at(-1)).toBe("trading");
  expect(unexpected).toEqual([]);
  await expect(page.getByRole("button", { name: "Scans" })).toHaveCount(0);
});

test("a late profile response keeps hidden views closed until local preferences are verified", async ({ page }) => {
  let releaseProfile!: () => void;
  const profileRelease = new Promise<void>(resolve => { releaseProfile = resolve; });
  const writes: string[] = [];
  await page.route("**/v1/local/session/status", route => route.fulfill({ json: { profileId: "fixture-profile", authenticated: true, brokerAccount: null, environment: null, executionEnabled: false, csrf: "fixture-csrf" } }));
  await page.route("**/v1/local/profile", async route => {
    await profileRelease;
    await route.fulfill({ json: { profileId: "fixture-profile", selectedView: "journal", brokerAccount: null, executionEnabled: false } });
  });
  await page.route("**/v1/local/profile/view", async route => {
    const body = route.request().postDataJSON() as { view: string };
    writes.push(body.view);
    await route.fulfill({ json: { selectedView: body.view, executionEnabled: false } });
  });
  await serveBothViews(page);
  await page.goto("/standalone/");
  await expect(page.getByRole("button", { name: "Explore Trading with sample data" })).toHaveCount(0);
  await page.route("**/v1/local/binding", route => route.fulfill({ json: {
    remembered: false, environment: null, accountMask: null, connectionVerified: false,
    reconciliationRequired: true, executionEnabled: false,
  } }));
  releaseProfile();
  await expect(page.getByRole("heading", { name: "Trading journal" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Trading", exact: true }).click();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toBeVisible();
  await expect.poll(() => writes.at(-1)).toBe("trading");
  await expect(page.getByRole("heading", { name: "Trading journal" })).toHaveCount(0);
});

for (const [label, sdk, tws, environment] of [
  ["missing SDK", "missing", "unavailable", "unverified"],
  ["incompatible SDK", "incompatible", "available", "paper"],
  ["TWS unavailable", "compatible", "unavailable", "paper"],
  ["TWS read-only", "compatible", "read-only", "paper"],
  ["environment unverified", "compatible", "available", "unverified"],
] as const) {
  test(`synthetic Connect fixture keeps ${label} locked`, async ({ page }) => {
    const unexpected: string[] = [];
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/v1/local/session/status") {
        await route.fulfill({ json: { profileId: "fixture-profile", authenticated: true,
          brokerAccount: null, environment: null, executionEnabled: false, csrf: "fixture-csrf",
          connectionFixture: { source: "synthetic-fixture", generation: "generation-1", sdk, tws, environment, accounts: ["DEMO-A", "DEMO-B"] } } });
        return;
      }
      if (url.pathname === "/v1/local/profile") {
        await route.fulfill({ json: { profileId: "fixture-profile", selectedView: "connect", brokerAccount: null, executionEnabled: false } });
        return;
      }
      if (url.pathname === "/v1/local/profile/view") {
        await route.fulfill({ json: { selectedView: "connect", executionEnabled: false } });
        return;
      }
      if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
        unexpected.push(`${route.request().method()} ${url.pathname}`);
        await route.fulfill({ status: 503, json: { detail: "Unexpected service request" } });
        return;
      }
      await route.continue();
    });
    await serveBothViews(page);
    await page.goto("/standalone/");
    await expect(page.getByText("Synthetic setup walkthrough.", { exact: false })).toBeVisible();
    await page.getByLabel("Synthetic account candidate").selectOption("DEMO-A");
    await expect(page.getByRole("button", { name: "Confirm walkthrough choice" })).toBeDisabled();
    await expect(page.getByRole("region", { name: "Execution status" })).toContainText("Order submission locked");
    await expect(page.getByText("Confirmation is blocked until", { exact: false })).toBeVisible();
    expect(unexpected).toEqual([]);
  });
}

test("synthetic candidate confirmation is explicit, resets on account change and ignores a stale refresh", async ({ page }) => {
  let holdRefresh = false;
  let refreshCalls = 0;
  let releaseRefresh!: () => void;
  const refreshRelease = new Promise<void>(resolve => { releaseRefresh = resolve; });
  const unexpected: string[] = [];
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/local/session/status") {
      if (holdRefresh) { refreshCalls += 1; await refreshRelease; }
      await route.fulfill({ json: { profileId: "fixture-profile", authenticated: true,
        brokerAccount: null, environment: null, executionEnabled: false, csrf: "fixture-csrf",
        connectionFixture: { source: "synthetic-fixture", generation: holdRefresh ? "generation-2" : "generation-1",
          sdk: "compatible", tws: "available", environment: "paper", accounts: ["DEMO-A", "DEMO-B"] } } });
      return;
    }
    if (url.pathname === "/v1/local/profile") {
      await route.fulfill({ json: { profileId: "fixture-profile", selectedView: "connect", brokerAccount: null, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/profile/view") {
      await route.fulfill({ json: { selectedView: route.request().postDataJSON().view, executionEnabled: false } });
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
      unexpected.push(`${route.request().method()} ${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected request" } });
      return;
    }
    await route.continue();
  });
  await serveBothViews(page);
  await page.goto("/standalone/");
  const choice = page.getByLabel("Synthetic account candidate");
  const confirm = page.getByRole("button", { name: "Confirm walkthrough choice" });
  await expect(choice).toBeVisible();
  await expect(confirm).toBeDisabled();
  await choice.selectOption("DEMO-A");
  await confirm.click();
  await expect(page.getByText("Synthetic choice DEMO-A recorded", { exact: false })).toBeVisible();
  holdRefresh = true;
  await page.getByRole("button", { name: "Refresh synthetic local status" }).click();
  await expect.poll(() => refreshCalls).toBe(1);
  await choice.selectOption("DEMO-B");
  await expect(page.getByText("Synthetic choice DEMO-A recorded", { exact: false })).toHaveCount(0);
  releaseRefresh();
  await expect(page.getByText("Account choice changed during refresh", { exact: false })).toBeVisible();
  await expect(choice).toHaveValue("DEMO-B");
  await confirm.click();
  await expect(page.getByText("Synthetic choice DEMO-B recorded", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "Execution status" })).toContainText("Order submission locked");
  expect(unexpected).toEqual([]);
});

test("revoked local view write clears confirmed fixture choice and a delayed refresh cannot restore it", async ({ page }) => {
  let releaseViewWrite!: () => void;
  let releaseRefresh!: () => void;
  const viewWriteGate = new Promise<void>(resolve => { releaseViewWrite = resolve; });
  const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
  let statusCalls = 0;
  let refreshing = false;
  let viewWrites = 0;
  const unexpected: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/local/session/status") {
      if (refreshing) { statusCalls += 1; await refreshGate; }
      await route.fulfill({ json: { profileId: "fixture-profile", authenticated: true,
        brokerAccount: null, environment: null, executionEnabled: false, csrf: "fixture-csrf",
        connectionFixture: { source: "synthetic-fixture", generation: "generation-1",
          sdk: "compatible", tws: "available", environment: "paper", accounts: ["DEMO-A", "DEMO-B"] } } });
      return;
    }
    if (url.pathname === "/v1/local/profile" && request.method() === "GET") {
      await route.fulfill({ json: { profileId: "fixture-profile", selectedView: "connect",
        brokerAccount: null, executionEnabled: false } });
      return;
    }
    if (url.pathname === "/v1/local/profile/view" && request.method() === "PUT") {
      viewWrites += 1;
      await viewWriteGate;
      await route.fulfill({ status: 401, json: { detail: "Expired local session" } });
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
      unexpected.push(`${request.method()} ${url.hostname}${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected service call" } });
      return;
    }
    await route.continue();
  });

  await serveBothViews(page);
  await page.goto("/standalone/");
  const choice = page.getByLabel("Synthetic account candidate");
  await expect(choice).toBeVisible();
  await choice.selectOption("DEMO-A");
  await page.getByRole("button", { name: "Confirm walkthrough choice" }).click();
  await expect(page.getByText("Synthetic choice DEMO-A recorded", { exact: false })).toBeVisible();
  await expect.poll(() => viewWrites).toBe(1);
  refreshing = true;
  await page.getByRole("button", { name: "Refresh synthetic local status" }).click();
  await expect.poll(() => statusCalls).toBe(1);

  releaseViewWrite();
  await expect(page.getByRole("region", { name: "Connection readiness" })).toContainText("Sample mode");
  await expect(choice).toHaveCount(0);
  await expect(page.getByText("Synthetic choice DEMO-A recorded", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Execution status" })).toContainText("Order submission locked");

  const staleResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/v1/local/session/status");
  releaseRefresh();
  await staleResponse;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(choice).toHaveCount(0);
  await expect(page.getByText("Synthetic choice DEMO-A recorded", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Connection readiness" })).toContainText("Sample mode");
  expect(unexpected).toEqual([]);
});

for (const [caseName, refreshStatus] of [
  ["expired local session", 401],
  ["forbidden local session", 403],
  ["changed local profile", 200],
] as const) {
  test(`synthetic confirmation is cleared on ${caseName}`, async ({ page }) => {
    let refreshing = false;
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/v1/local/session/status") {
        if (refreshing && refreshStatus !== 200) { await route.fulfill({ status: refreshStatus, json: { detail: "session unavailable" } }); return; }
        await route.fulfill({ json: { profileId: refreshing ? "other-profile" : "fixture-profile",
          authenticated: true, brokerAccount: null, environment: null, executionEnabled: false, csrf: "fixture-csrf",
          connectionFixture: { source: "synthetic-fixture", generation: "generation-1", sdk: "compatible", tws: "available", environment: "paper", accounts: ["DEMO-A", "DEMO-B"] } } });
        return;
      }
      if (url.pathname === "/v1/local/profile") {
        await route.fulfill({ json: { profileId: "fixture-profile", selectedView: "connect", brokerAccount: null, executionEnabled: false } });
        return;
      }
      if (url.pathname === "/v1/local/profile/view") {
        const body = route.request().postDataJSON() as { view: string };
        await route.fulfill({ json: { selectedView: body.view, executionEnabled: false } });
        return;
      }
      if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
        throw new Error(`Unexpected external or trading request: ${route.request().method()} ${url.pathname}`);
      }
      await route.continue();
    });
    await page.route("**/v1/local/binding", route => route.fulfill({ json: {
      remembered: false, environment: null, accountMask: null,
      connectionVerified: false, reconciliationRequired: true, executionEnabled: false,
    } }));
    await serveBothViews(page);
    await page.goto("/standalone/");
    await page.getByRole("button", { name: "Explore Trading with sample data" }).click();
    await page.getByLabel("Stock symbol", { exact: true }).fill("AAPL");
    await page.getByRole("button", { name: "Save plan", exact: true }).click();
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Journal" }).click();
    await page.locator('[data-journal-trade-id="journal-amd"] button').click();
    await page.getByLabel("AMD One lesson").fill("Profile A only.");
    await page.getByRole("button", { name: "Save review" }).click();
    await expect(page.getByText("Review saved locally", { exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Connect" }).click();
    await page.getByLabel("Synthetic account candidate").selectOption("DEMO-A");
    await page.getByRole("button", { name: "Confirm walkthrough choice" }).click();
    await expect(page.getByText("Synthetic choice DEMO-A recorded", { exact: false })).toBeVisible();
    refreshing = true;
    await page.getByRole("button", { name: "Refresh synthetic local status" }).click();
    await expect(page.getByText("Synthetic choice DEMO-A recorded", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Execution status" })).toContainText("Order submission locked");
    await expect(page.getByLabel("Synthetic account candidate")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Connection readiness" })).toContainText("Sample mode");
    await expect(page.getByRole("button", { name: "Explore Trading with sample data" })).toHaveCount(0);
    await page.route("**/v1/local/session/status", route => route.fulfill({ status: 401, json: { detail: "Anonymous preview" } }));
    await page.reload();
    await page.getByRole("button", { name: "Explore Trading with sample data" }).click();
    await expect(page.getByLabel("Stock symbol", { exact: true })).not.toHaveValue("AAPL");
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Journal" }).click();
    await page.locator('[data-journal-trade-id="journal-amd"] button').click();
    await expect(page.getByLabel("AMD One lesson")).toHaveValue("");
    const storedProfileData = await page.evaluate(() => ({
      plan: localStorage.getItem("brontide-standalone-sample-v1:profile:fixture-profile:journal.trade-planner.draft.v1"),
      review: localStorage.getItem("brontide-standalone-sample-v1:profile:fixture-profile:brontide-journal-reviews-v1"),
    }));
    expect(storedProfileData.plan).toContain("AAPL");
    expect(storedProfileData.review).toContain("Profile A only.");
  });
}


test("artificial installed-profile history preserves cents and read-only reviews", async ({ page }) => {
  const history = structuredClone(syntheticHistory);
  const binding = "fixture-83e26da0-61db-4c42-a9e1-ca28c770ca0f";
  history.journalCampaigns[0].accountBinding = binding;
  await page.route("**/v1/local/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const values: Record<string, unknown> = {
      "/v1/local/session/status": { profileId: "local-fixture", authenticated: true, brokerAccount: null,
        environment: null, executionEnabled: false, csrf: "fixture-csrf", verificationProfile: true, verificationBinding: binding },
      "/v1/local/profile": { profileId: "local-fixture", selectedView: "journal", brokerAccount: null, executionEnabled: false },
      "/v1/local/modules": { enabledViews: ["trading", "journal"], canHideTrading: true, executionEnabled: false },
      "/v1/local/journal/verification": history,
      "/v1/local/profile/view": { selectedView: "journal", executionEnabled: false },
    };
    await route.fulfill({ status: path in values ? 200 : 503, json: values[path] ?? {detail: "Not used"} });
  });
  await page.goto("/standalone/");
  await expect(page.getByText("Artificial verification history", {exact: true})).toBeVisible();
  await page.getByRole("button", {name: "TEST", exact: true}).click();
  const detail = page.getByRole("region", {name: "TEST entry and exit details"});
  await expect(detail).toContainText("$0.20");
  await expect(detail).toContainText("+$2.00 / provisional / Unavailable");
  await expect(page.getByRole("button", {name: "Save review"})).toHaveCount(0);
  await expect(page.getByText("Grade C", {exact: false})).toHaveCount(0);
  const campaign = history.journalCampaigns[0];
  Object.assign(campaign, {state: "Closed"});
  Object.assign(campaign.executions[0], {commission: .4});
  Object.assign(campaign.executions[1], {quantity: 2, price: 103, commission: .3});
  Object.assign(campaign.summary, {exited: 2, openQuantity: 0, costsComplete: true,
    fees: .7, grossRealized: 6, netRealized: 5.3, finalNetR: 1.325});
  Object.assign(history.records[0], {state: "Closed", exited: 2, recordedOpenQuantity: 0,
    costsCompleteRecorded: true, fees: .7, grossRealized: 6, netRealized: 5.3, finalNetR: 1.325});
  await page.reload();
  await expect(page.getByRole("region", {name: "Trading statistics"})).toContainText("+$5.30");
  await page.getByRole("button", {name: "TEST", exact: true}).click();
  await expect(detail).toContainText("+$6.00 / +$0.70 / +$5.30");
  await expect(detail).toContainText("2 / 2 / 0");
  await page.setViewportSize({width: 1280, height: 900});
  await page.evaluate(() => {
    const sizes = Array.from(document.querySelectorAll<HTMLElement>("body,body *"))
      .map(element => ({element, size: parseFloat(getComputedStyle(element).fontSize)}));
    sizes.forEach(({element, size}) => element.style.fontSize = `${size * 2}px`);
  });
  const header = await page.locator(".journal-content .topbar").boundingBox();
  const heading = await page.getByRole("heading", {name: "Trading journal", exact: true}).boundingBox();
  const notice = await page.locator(".journal-content > .workspace-notice").boundingBox();
  expect(header && heading && notice).toBeTruthy();
  expect(heading!.y + heading!.height).toBeLessThanOrEqual(header!.y + header!.height);
  expect(notice!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
});
