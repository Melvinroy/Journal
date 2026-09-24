import { expect, test } from "@playwright/test";

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
  await expect(page.getByRole("button", { name: "Plan & Position" })).toBeVisible();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toBeVisible();
  await page.getByLabel("Stock symbol", { exact: true }).fill("DRAFTSAFE");
  await page.getByLabel("Captured planning entry price").fill("123.45");

  await page.getByRole("navigation", { name: "Trading views" }).getByRole("button", { name: "Journal" }).click();
  await expect(page.getByRole("heading", { name: "Trading journal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scans" })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Trading views" }).getByRole("button", { name: "Plan & Position" }).click();
  await expect(page.getByLabel("Stock symbol", { exact: true })).toHaveValue("DRAFTSAFE");
  await expect(page.getByLabel("Captured planning entry price")).toHaveValue("123.45");
  expect(serviceCalls).toEqual([]);
});

test("standalone view choice survives reload and remains usable at mobile width", async ({ page }) => {
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

test("a late profile response cannot replace a newer user navigation", async ({ page }) => {
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
  await page.goto("/standalone/");
  await page.getByRole("button", { name: "Explore Trading with sample data" }).click();
  releaseProfile();
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
      await route.fulfill({ json: { selectedView: "connect", executionEnabled: false } });
      return;
    }
    if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
      unexpected.push(`${route.request().method()} ${url.pathname}`);
      await route.fulfill({ status: 503, json: { detail: "Unexpected request" } });
      return;
    }
    await route.continue();
  });
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

for (const [caseName, refreshStatus] of [
  ["expired local session", 401],
  ["changed local profile", 200],
] as const) {
  test(`synthetic confirmation is cleared on ${caseName}`, async ({ page }) => {
    let refreshing = false;
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/v1/local/session/status") {
        if (refreshing && refreshStatus === 401) { await route.fulfill({ status: 401, json: { detail: "expired" } }); return; }
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
        await route.fulfill({ json: { selectedView: "connect", executionEnabled: false } });
        return;
      }
      if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) {
        throw new Error(`Unexpected external or trading request: ${route.request().method()} ${url.pathname}`);
      }
      await route.continue();
    });
    await page.goto("/standalone/");
    await page.getByLabel("Synthetic account candidate").selectOption("DEMO-A");
    await page.getByRole("button", { name: "Confirm walkthrough choice" }).click();
    await expect(page.getByText("Synthetic choice DEMO-A recorded", { exact: false })).toBeVisible();
    refreshing = true;
    await page.getByRole("button", { name: "Refresh synthetic local status" }).click();
    await expect(page.getByText("Synthetic choice DEMO-A recorded", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Execution status" })).toContainText("Order submission locked");
    await expect(page.getByLabel("Synthetic account candidate")).toHaveCount(0);
  });
}
