import { expect, test, type Page } from "@playwright/test";
import {
  expectContained,
  expectContainedScroller,
  expectGeometryWithin,
  geometry,
  type Geometry,
} from "./layout-assertions";

async function openDemo(page: Page) {
  await page.goto("/?demo=1");
  await expect(
    page.getByRole("button", { name: "Workspace navigation" }),
  ).toBeVisible();
}

async function navigateTo(
  page: Page,
  name: "Discover" | "Charts" | "Strategies" | "Trading",
) {
  const destination = page.getByRole("button", { name, exact: true });
  const menu = page.getByRole("button", { name: "Workspace navigation" });
  await expect(destination.or(menu)).toBeVisible();
  if (!(await destination.isVisible())) {
    await menu.click();
    await expect(destination).toBeVisible();
  }
  await destination.click();
}

async function dividerGeometry(page: Page): Promise<Geometry> {
  return page
    .getByRole("navigation", { name: "Trading views" })
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const border =
        parseFloat(getComputedStyle(element).borderBottomWidth) || 0;
      const y = rect.bottom - border;
      return {
        x: rect.x,
        y,
        width: rect.width,
        height: border,
        right: rect.right,
        bottom: y + border,
      };
    });
}

test("served preview identifies the current checkout including source edits", async ({
  page,
}) => {
  await openDemo(page);
  const expected = process.env.BRONTIDE_EXPECTED_PREVIEW_ID;
  expect(
    expected,
    "Playwright must calculate the expected preview identifier",
  ).toBeTruthy();
  const marker = page.locator("[data-preview-identifier]");
  await expect(marker).toHaveAttribute("data-preview-identifier", expected!);
  await expect(marker).toContainText(`Preview ${expected}`);
});

test("invalid scan dates and risk defaults are rejected without corrupting the active view", async ({
  page,
}) => {
  await openDemo(page);
  await navigateTo(page, "Discover");
  const from = page.getByLabel("From");
  await expect(from).toHaveValue("2026-08-05");
  await from.fill("2026-12-31");
  await expect(page.locator("#scan-date-error")).toContainText(
    "From date must be on or before To date",
  );
  await expect(from).toHaveValue("2026-08-05");
  await expect(page.getByText("Aug 5, 2026 – Sep 3, 2026")).toBeVisible();

  await navigateTo(page, "Trading");
  await page.getByRole("button", { name: "Change", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Risk settings" });
  await dialog.getByLabel("Account equity").fill("0");
  await dialog.getByRole("button", { name: "Save defaults" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("greater than zero");
  await expect(page.getByLabel("Risk controls")).toContainText("0.50%");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("planner derives sourced ATR and day-extreme stops, then preserves explicit manual prices", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  await navigateTo(page, "Trading");

  const method = page.getByLabel("Stop method");
  const multiplier = page.getByLabel("ATR multiplier");
  const entry = page.getByLabel("Captured planning entry price");
  const stop = page.getByLabel("Stop price");
  await expect(method).toHaveValue("ATR");
  await expect(entry).toHaveValue("100");
  await expect(multiplier).toHaveValue("1");
  await expect(stop).toHaveValue("98");
  await expect(page.getByText(/ATR \$2\.00 × 1/)).toBeVisible();
  await expect(
    page.getByText(/Simulated fixture · Sep 3, 2026 · Sample/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Risk settings" })
    .getByRole("button", { name: "20%", exact: true })
    .click();
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByLabel("Position sizing result")).toContainText("60");
  await expect(page.getByLabel("Position sizing result")).toContainText(
    "$6,000",
  );
  await expect(page.getByLabel("Position sizing result")).toContainText("$120");

  await multiplier.fill("1.5");
  await expect(stop).toHaveValue("97");
  await page.getByRole("button", { name: "Short", exact: true }).click();
  await expect(stop).toHaveValue("103");
  await method.selectOption("HoD");
  await expect(method.locator("option:checked")).toHaveText("Day high · Sep 3");
  await expect(stop).toHaveValue("101");
  await expect(
    page.getByText("Sep 3, 2026 completed-session high $101.00"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Long", exact: true }).click();
  await expect(method).toHaveValue("LoD");
  await expect(method.locator("option:checked")).toHaveText("Day low · Sep 3");
  await expect(stop).toHaveValue("99");
  await expect(
    page.getByText("Sep 3, 2026 completed-session low $99.00"),
  ).toBeVisible();

  await stop.fill("97.5");
  await expect(method).toHaveValue("Manual");
  await page.getByRole("button", { name: "Short", exact: true }).click();
  await expect(stop).toHaveValue("97.5");
  await expect(
    page.locator(
      ".trade-ticket:not(.trade-after-fill-ticket) .trade-validation",
    ),
  ).toContainText("short stop must be above entry");

  await method.selectOption("ATR");
  await page.getByLabel("Stock symbol").fill("ZZZZ");
  await expect(
    page.locator(
      ".trade-ticket:not(.trade-after-fill-ticket) .trade-validation",
    ),
  ).toContainText("ATR is unavailable");
  await expect(
    page.locator(
      ".trade-ticket:not(.trade-after-fill-ticket) .trade-validation",
    ),
  ).toContainText("No simulated daily data exists");
  await method.selectOption("Manual");
  await stop.fill("105");
  await expect(
    page.locator(
      ".trade-ticket:not(.trade-after-fill-ticket) .trade-validation",
    ),
  ).toBeHidden();
});

test("planner reopens reproducible saves and preserves legacy stop method and price", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  await navigateTo(page, "Trading");
  await page.getByLabel("ATR multiplier").fill("1.5");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Trade planner" }),
  ).toBeVisible();
  await expect(page.getByLabel("Stop method")).toHaveValue("ATR");
  await expect(page.getByLabel("ATR multiplier")).toHaveValue("1.5");
  await expect(page.getByLabel("Captured planning entry price")).toHaveValue(
    "100",
  );
  await expect(page.getByLabel("Stop price")).toHaveValue("97");
  await expect(
    page.getByText(/Simulated fixture · Sep 3, 2026 · Sample/),
  ).toBeVisible();

  await page.evaluate(() => {
    localStorage.setItem(
      "brontide-demo-review:journal.trade-planner.draft.v1",
      JSON.stringify({
        symbol: "AAPL",
        side: "Long",
        entryPrice: 100,
        stopPrice: 96.25,
        stopSource: "LoD",
        accountEquity: 30000,
        riskPercent: 0.5,
        maxAllocationPercent: 20,
        savedAt: "2026-09-01T12:00:00Z",
      }),
    );
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Trade planner" }),
  ).toBeVisible();
  await expect(page.getByLabel("Stock symbol")).toHaveValue("AAPL");
  await expect(page.getByLabel("Stop method")).toHaveValue("LoD");
  await expect(page.getByLabel("Stop price")).toHaveValue("96.25");
  await expect(
    page.locator(
      ".trade-ticket:not(.trade-after-fill-ticket) .trade-validation",
    ),
  ).toContainText("saved draft has no recorded market-data source");
});

test("exit-plan controls conserve shares, preserve independent rules, and reopen authoritative inputs", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/?demo=1");
  await expect(
    page.getByRole("button", { name: "Workspace navigation" }),
  ).toBeVisible();
  await navigateTo(page, "Trading");
  await page.getByLabel("Captured planning entry price").fill("120");
  await page.getByLabel("Stop price").fill("118");
  await expect(page.getByLabel("Position sizing result")).toContainText("37");

  await page
    .getByRole("group", { name: "Target count" })
    .getByRole("button", { name: "1", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Runner count" })
    .getByRole("button", { name: "2", exact: true })
    .click();
  await expect(
    page.locator(".trade-leg-name").filter({ hasText: "T1" }),
  ).toContainText("13 sh");
  await expect(
    page.locator(".trade-leg-name").filter({ hasText: "Runner A" }),
  ).toContainText("13 sh");
  await expect(
    page.locator(".trade-leg-name").filter({ hasText: "Runner B" }),
  ).toContainText("11 sh");

  await page.getByLabel("Runner A activation R").fill("1.5");
  await page.getByLabel("Runner A trailing method").selectOption("SMA20");
  await page.getByLabel("Runner B activation R").fill("3");
  await page.getByLabel("Runner B trailing method").selectOption("Dollar");
  await page.getByLabel("Runner B dollar distance").fill("2.5");
  await page.getByLabel("Breakeven activation").selectOption("2");
  await page.getByLabel("Breakeven offset unit").selectOption("R");
  await page.getByLabel("Breakeven offset value").fill("0.25");
  await page.getByRole("button", { name: "Save exits", exact: true }).click();
  await expect(page.getByText(/Exit-plan draft saved locally/)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "After-fill plan" }),
  ).toBeVisible();
  await expect(page.getByLabel("Runner A activation R")).toHaveValue("1.5");
  await expect(page.getByLabel("Runner A trailing method")).toHaveValue(
    "SMA20",
  );
  await expect(page.getByLabel("Runner B activation R")).toHaveValue("3");
  await expect(page.getByLabel("Runner B trailing method")).toHaveValue(
    "Dollar",
  );
  await expect(page.getByLabel("Runner B dollar distance")).toHaveValue("2.5");
  await expect(page.getByLabel("Breakeven activation")).toHaveValue("2");
  await expect(page.getByLabel("Breakeven offset unit")).toHaveValue("R");
  await expect(page.getByLabel("Breakeven offset value")).toHaveValue("0.25");

  await page
    .getByRole("group", { name: "Target count" })
    .getByRole("button", { name: "2", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Runner count" })
    .getByRole("button", { name: "1", exact: true })
    .click();
  await page.getByLabel("T1 authoritative input").selectOption("Price");
  await page.getByLabel("T1 target price").fill("126.5");
  await page.getByRole("button", { name: "Save exits", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "After-fill plan" }),
  ).toBeVisible();
  await expect(page.getByLabel("T1 authoritative input")).toHaveValue("Price");
  await expect(page.getByLabel("T1 target price")).toHaveValue("126.5");
  await expect(page.getByLabel("T2 authoritative input")).toHaveValue("R");
});

test("exit-plan validation and storage failures retain unsaved edits without replacing saved plans", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  await expect(
    page.getByRole("button", { name: "Workspace navigation" }),
  ).toBeVisible();
  await navigateTo(page, "Trading");
  await page.getByLabel("Captured planning entry price").fill("120");
  await page.getByLabel("Stop price").fill("118");
  await page.getByRole("button", { name: "Save exits", exact: true }).click();
  const savedBefore = await page.evaluate(() =>
    localStorage.getItem(
      "brontide-demo-review:journal.trade-planner.after-fill-stage.v1",
    ),
  );

  await page.getByLabel("T1 allocation percent").fill("34");
  await page.getByRole("button", { name: "Save exits", exact: true }).click();
  await expect(
    page.locator(".trade-after-fill-ticket .trade-validation"),
  ).toContainText("total 100%");
  await expect(page.getByLabel("T1 allocation percent")).toHaveValue("34");
  expect(
    await page.evaluate(() =>
      localStorage.getItem(
        "brontide-demo-review:journal.trade-planner.after-fill-stage.v1",
      ),
    ),
  ).toBe(savedBefore);

  await page.getByLabel("T1 allocation percent").fill("35");
  await page.getByLabel("Captured planning entry price").fill("2000");
  await page.getByLabel("Stop price").fill("1999");
  await expect(
    page.locator(".trade-after-fill-ticket .trade-validation"),
  ).toContainText("too small to allocate");
  await expect(page.getByLabel("T1 allocation percent")).toHaveValue("35");

  await page.getByLabel("Captured planning entry price").fill("120");
  await page.getByLabel("Stop price").fill("118");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.includes("after-fill-stage"))
        throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.getByLabel("T1 target R").fill("1.25");
  await page.getByRole("button", { name: "Save exits", exact: true }).click();
  await expect(page.getByText(/save failed.*edits remain/i)).toBeVisible();
  await expect(page.getByLabel("T1 target R")).toHaveValue("1.25");
});

test("preset operations are isolated from exit drafts and saved plans", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  await expect(
    page.getByRole("button", { name: "Workspace navigation" }),
  ).toBeVisible();
  await navigateTo(page, "Trading");
  await page.getByRole("button", { name: "Save exits", exact: true }).click();
  const savedPlan = await page.evaluate(() =>
    localStorage.getItem(
      "brontide-demo-review:journal.trade-planner.after-fill-stage.v1",
    ),
  );

  await page.getByLabel("Preset name").fill("Scale and trail");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await expect(
    page.getByText(/current draft and saved plans were not changed/i),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem(
        "brontide-demo-review:journal.trade-planner.after-fill-stage.v1",
      ),
    ),
  ).toBe(savedPlan);

  await page.getByLabel("T1 target R").fill("1.75");
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.getByLabel("T1 target R")).toHaveValue("1");
  await expect(
    page.getByText(/loaded into this unsaved draft only/i),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem(
        "brontide-demo-review:journal.trade-planner.after-fill-stage.v1",
      ),
    ),
  ).toBe(savedPlan);

  await page.getByLabel("Preset name").fill("Renamed trail");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  expect(
    await page.evaluate(() =>
      localStorage.getItem(
        "brontide-demo-review:journal.trade-planner.after-fill-stage.v1",
      ),
    ),
  ).toBe(savedPlan);

  await page.getByLabel("T1 authoritative input").selectOption("Price");
  await page.getByLabel("Preset name").fill("Absolute levels");
  await page.getByLabel("Preset scope").selectOption("General");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await expect(
    page.getByText(/General presets may store only R-based targets/),
  ).toBeVisible();
  await page.getByLabel("Preset scope").selectOption("Symbol");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await expect(page.getByText(/Preset “Absolute levels” saved/)).toBeVisible();

  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.includes("exit-presets"))
        throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.getByLabel("Preset name").fill("Retained after failure");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await expect(page.getByText(/Preset save failed/)).toBeVisible();
  await expect(page.getByLabel("Preset name")).toHaveValue(
    "Retained after failure",
  );
});

test("actual-position changes require an explicit unapplied amendment draft", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  await navigateTo(page, "Trading");
  const savedRecordBefore = await page.evaluate(() =>
    localStorage.getItem("brontide-demo-review:brontide-plans-v1"),
  );
  await page
    .locator(".saved-plan-card")
    .filter({ hasText: "MRNA" })
    .getByRole("button", { name: "Open details" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Saved plan details" });
  await expect(dialog.getByText(/Actual position · read only/)).toBeVisible();
  await expect(dialog.getByLabel("Target")).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Draft position amendment" })
    .click();
  await expect(dialog.getByText(/Unapplied amendment draft/)).toBeVisible();
  await dialog.getByLabel("Target").fill("106");
  await dialog.getByRole("button", { name: "Keep unapplied draft" }).click();
  await expect(
    page.getByText(/No position or broker order changed/),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("brontide-demo-review:brontide-plans-v1"),
    ),
  ).toBe(savedRecordBefore);
});

test("primary detail surfaces support keyboard entry, Escape, focus containment, and scroll locking", async ({
  page,
}) => {
  await openDemo(page);
  await navigateTo(page, "Discover");
  await page.getByRole("button", { name: "Catalysts", exact: true }).click();
  const catalystRow = page.locator(
    'tr[aria-label="Open NVDA catalyst detail"]',
  );
  await catalystRow.focus();
  await page.keyboard.press("Enter");
  const catalystDialog = page.getByRole("dialog", {
    name: "NVDA catalyst detail",
  });
  await expect(catalystDialog).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("hidden");
  await page.keyboard.press("Escape");
  await expect(catalystDialog).toBeHidden();

  await navigateTo(page, "Strategies");
  const strategyRow = page.locator(
    'tr[aria-label="Open EP-016 strategy details"]',
  );
  await strategyRow.focus();
  await page.keyboard.press("Enter");
  const strategyDialog = page.getByRole("dialog", {
    name: "Winners and losers",
  });
  await expect(strategyDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(strategyDialog).toBeHidden();

  await navigateTo(page, "Trading");
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  const logTrade = page.getByRole("button", { name: "Log trade" });
  await logTrade.click();
  const journalDialog = page.getByRole("dialog", { name: "Log a trade" });
  await expect(journalDialog.getByLabel("Symbol")).toBeFocused();
  const saveTrade = journalDialog.getByRole("button", { name: "Save trade" });
  await saveTrade.click();
  await expect(journalDialog).toBeVisible();
  await expect(journalDialog.getByLabel("Symbol")).toBeFocused();
  await saveTrade.focus();
  await page.keyboard.press("Tab");
  await expect(
    journalDialog.getByRole("button", { name: "Close" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(saveTrade).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(journalDialog).toBeHidden();
  await expect(logTrade).toBeFocused();
});

test("position controls remain simulated and unlinked records require an explicit association", async ({
  page,
}) => {
  await openDemo(page);
  await navigateTo(page, "Trading");
  await expect(
    page.getByText(/No broker connection · broker submission disabled/),
  ).toBeVisible();
  await expect(page.getByText(/Never auto-linked by ticker/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Link or create record" }),
  ).toBeEnabled();
  const submission = page.getByRole("button", { name: "Submit paper order" });
  await expect(submission).toHaveCount(1);
  await expect(submission).toBeDisabled();
  await expect(page.getByText(/submission lock.*explicit approval/i)).toBeVisible();
});

test("read-only paper snapshots stay isolated, duplicate-free, and recover after a client disconnect", async ({
  page,
}) => {
  const observedAt = "2026-09-10T04:30:00Z";
  const positions = [
    {
      id: "ibkr-position-one",
      accountId: "ibkr-account-test",
      instrumentId: "IBKR-STK:101",
      positionRevision: "ibkr-revision-one",
      symbol: "ALFA",
      direction: "Long",
      quantity: 12,
      averageEntry: 100,
      marketValue: null,
      changedAt: observedAt,
      currency: "USD",
      exchange: "SMART",
      snapshotState: "current",
      associationEligible: true,
      missingInformation: [],
      stale: false,
    },
    {
      id: "ibkr-position-two",
      accountId: "ibkr-account-test",
      instrumentId: "IBKR-STK:202",
      positionRevision: "ibkr-revision-two",
      symbol: "BETA",
      direction: "Short",
      quantity: 7,
      averageEntry: 50,
      marketValue: null,
      changedAt: observedAt,
      currency: "USD",
      exchange: "SMART",
      snapshotState: "current",
      associationEligible: true,
      missingInformation: [],
      stale: false,
    },
  ];
  const connected = {
    mode: "read-only",
    source: "IBKR TWS",
    connectionStatus: "connected",
    dataStatus: "fresh",
    lastSuccessfulUpdate: observedAt,
    account: {
      id: "ibkr-account-test",
      maskedId: "DU•••1234",
      value: 30000,
      currency: "USD",
      source: "IBKR accountSummary",
      observedAt,
      available: true,
    },
    positions,
    openOrders: [],
    error: null,
  };
  let failNextRefresh = false;
  let brokerRequests = 0;
  await page.route("**/v1/ibkr/read-only**", async (route) => {
    brokerRequests += 1;
    const request = route.request();
    if (request.url().endsWith("/disconnect")) {
      await route.fulfill({
        json: {
          ...connected,
          connectionStatus: "disconnected",
          dataStatus: "stale",
          positions: positions.map((item) => ({ ...item, stale: true })),
        },
      });
      return;
    }
    if (request.url().endsWith("/refresh") && failNextRefresh) {
      failNextRefresh = false;
      await route.fulfill({ status: 503, json: { detail: "simulated outage" } });
      return;
    }
    await route.fulfill({ json: connected });
  });

  await page.goto("/");
  await navigateTo(page, "Trading");
  const unlinked = page.locator(".unlinked-positions > article");
  await expect(unlinked).toHaveCount(2);
  await expect(page.getByText("Open orders: 0 · completed empty")).toBeVisible();
  await expect(page.getByText("$30,000.00")).toBeVisible();
  await expect(page.getByText(/IBKR accountSummary · USD/)).toBeVisible();
  await expect(page.getByText(/Never auto-linked by ticker/)).toHaveCount(2);
  expect(
    await page.evaluate(() => ({
      campaigns: localStorage.getItem("brontide-position-campaigns-v1"),
      associations: localStorage.getItem("brontide-position-associations-v1"),
    })),
  ).toEqual({ campaigns: null, associations: null });

  await page.getByRole("button", { name: "Refresh paper data" }).click();
  await expect(unlinked).toHaveCount(2);

  failNextRefresh = true;
  await page.getByRole("button", { name: "Refresh paper data" }).click();
  await expect(page.locator(".broker-refresh-alert")).toContainText(
    "Last completed positions were retained and marked stale",
  );
  await expect(unlinked).toHaveCount(2);

  await page.getByRole("button", { name: "Disconnect Brontide" }).click();
  await expect(page.getByText("disconnected", { exact: true })).toBeVisible();
  await expect(unlinked).toHaveCount(2);
  await page.getByRole("button", { name: "Refresh paper data" }).click();
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await expect(unlinked).toHaveCount(2);
  expect(brokerRequests).toBeGreaterThanOrEqual(5);

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await expectContained(page, ".broker-readonly-status", true);
    for (let index = 0; index < 2; index += 1) {
      await expectContained(
        page,
        `.unlinked-positions > article:nth-of-type(${index + 1})`,
        true,
      );
    }
  }

  expect(
    await page.evaluate(() => ({
      campaigns: localStorage.getItem("brontide-position-campaigns-v1"),
      associations: localStorage.getItem("brontide-position-associations-v1"),
    })),
  ).toEqual({ campaigns: null, associations: null });
});

test("demo preview never requests paper-account data", async ({ page }) => {
  let brokerRequests = 0;
  await page.route("**/v1/ibkr/read-only**", async (route) => {
    brokerRequests += 1;
    await route.abort();
  });
  await openDemo(page);
  await navigateTo(page, "Trading");
  await expect(page.getByText(/SIMULATED PREVIEW/)).toBeVisible();
  expect(brokerRequests).toBe(0);
});

test("position detail reports accounting, protection and price-data limitations honestly", async ({
  page,
}) => {
  await openDemo(page);
  await navigateTo(page, "Trading");

  await page
    .getByRole("button", { name: "Open AAPL position details" })
    .click();
  let dialog = page.getByRole("dialog", { name: "AAPL position details" });
  await expect(dialog).toContainText("Filled entry");
  await expect(dialog).toContainText("40 sh");
  await expect(dialog).toContainText("Exited");
  await expect(dialog).toContainText("5 sh");
  await expect(dialog).toContainText("Remaining");
  await expect(dialog).toContainText("35 sh");
  await expect(dialog).toContainText("35/35 confirmed");
  await expect(dialog.getByText("Exit · manual")).toBeVisible();
  await page.keyboard.press("Escape");

  await page
    .getByRole("button", { name: "Open NVDA position details" })
    .click();
  dialog = page.getByRole("dialog", { name: "NVDA position details" });
  await expect(dialog).toContainText("30/37 protected · 7 unprotected");
  await expect(dialog).toContainText("Total remaining risk");
  await expect(dialog).toContainText("Unavailable");
  await expect(dialog).toContainText("Stale");
  await page.keyboard.press("Escape");

  await page
    .getByRole("button", { name: "Open TSLA position details" })
    .click();
  dialog = page.getByRole("dialog", { name: "TSLA position details" });
  await expect(dialog).toContainText("18 unprotected");
  await expect(dialog).toContainText(
    "Disconnected source · Unavailable · no valuation price",
  );
  await page.keyboard.press("Escape");

  await page
    .getByRole("button", { name: "Open MRNA position details" })
    .click();
  dialog = page.getByRole("dialog", { name: "MRNA position details" });
  await expect(dialog.getByText("Exit · target")).toBeVisible();
  await expect(dialog.getByText("Exit · manual")).toBeVisible();
  await expect(dialog.locator(".fill-list > div")).toHaveCount(3);
  await expect(dialog).toContainText("12 sh");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Open AMD position details" }).click();
  dialog = page.getByRole("dialog", { name: "AMD position details" });
  await expect(dialog).toContainText("Exited");
  await expect(dialog).toContainText("20 sh");
  await expect(dialog).toContainText("Remaining");
  await expect(dialog).toContainText("0 sh");
});

test("position amendments save and reopen independently, then reject stale quantity and storage failure", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openDemo(page);
  await navigateTo(page, "Trading");
  await page
    .getByRole("button", { name: "Open NVDA position details" })
    .click();
  const dialog = page.getByRole("dialog", { name: "NVDA position details" });
  await dialog.getByRole("button", { name: "Draft amendment" }).click();
  await expect(
    dialog.getByText("Unapplied amendment draft", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.locator(".trade-leg-name").filter({ hasText: "T1" }),
  ).toContainText("13 sh");
  await expect(
    dialog.locator(".trade-leg-name").filter({ hasText: "Runner A" }),
  ).toContainText("13 sh");
  await expect(
    dialog.locator(".trade-leg-name").filter({ hasText: "Runner B" }),
  ).toContainText("11 sh");
  await dialog.getByLabel("Runner A activation R").fill("1.75");
  await dialog.getByRole("button", { name: "Save amendment draft" }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "Unapplied amendment saved",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Open NVDA position details" })
    .click();
  await page
    .getByRole("dialog", { name: "NVDA position details" })
    .getByRole("button", { name: "Reopen amendment" })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "NVDA position details" })
      .getByLabel("Amendment Runner A activation R"),
  ).toHaveValue("1.75");
  const reopenedNvda = page.getByRole("dialog", {
    name: "NVDA position details",
  });
  page.once("dialog", (confirmation) => confirmation.accept());
  await reopenedNvda.getByRole("button", { name: "Discard draft" }).click();
  await expect(reopenedNvda.getByRole("status")).toContainText(
    "Unapplied amendment discarded",
  );
  await reopenedNvda.getByRole("button", { name: "Draft amendment" }).click();
  await reopenedNvda.getByLabel("Amendment Runner A activation R").fill("1.75");
  await reopenedNvda
    .getByRole("button", { name: "Save amendment draft" })
    .click();
  await expect(reopenedNvda.getByRole("status")).toContainText(
    "Unapplied amendment saved",
  );

  await page.evaluate(() => {
    localStorage.setItem(
      "brontide-demo-review:brontide-position-snapshot-overrides-v1",
      JSON.stringify({
        version: 1,
        value: {
          "demo-nvda-protection": {
            positionRevision: "nvda-r5",
            confirmedOpenQuantity: 36,
          },
        },
      }),
    );
    window.dispatchEvent(new Event("brontide-store"));
  });
  const updatedNvda = page.getByRole("dialog", {
    name: "NVDA position details",
  });
  await expect(
    updatedNvda.getByText(/Against 36 confirmed remaining shares/),
  ).toBeVisible();
  await updatedNvda
    .getByRole("button", { name: /Save amendment draft|Save again/ })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "NVDA position details" })
      .getByRole("alert"),
  ).toContainText("confirmed position changed");

  await page.reload();
  await expect(
    page.getByRole("button", { name: "Plan & Position", exact: true }),
  ).toBeVisible();
  await navigateTo(page, "Trading");
  await expect(
    page.getByRole("heading", { name: "Positions", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open MRNA position details" })
    .click();
  const mrna = page.getByRole("dialog", { name: "MRNA position details" });
  await mrna.getByRole("button", { name: "Draft amendment" }).click();
  await mrna.getByLabel("Breakeven activation").selectOption("2");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.includes("position-amendments"))
        throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await mrna.getByRole("button", { name: "Save amendment draft" }).click();
  await expect(mrna.getByRole("alert")).toContainText("Amendment save failed");
  await expect(mrna.getByLabel("Breakeven activation")).toHaveValue("2");
});

test("unlinked positions link once, navigate to Journal, and persist an honest unapplied amendment", async ({
  page,
}) => {
  await openDemo(page);
  await navigateTo(page, "Trading");
  await page.getByRole("button", { name: "Link or create record" }).click();
  const dialog = page.getByRole("dialog", { name: "Link MSFT position" });
  await expect(dialog).toContainText(
    "Match the exact account and instrument identity",
  );
  await dialog.getByRole("button", { name: "Link selected trade" }).click();
  await expect(
    page.getByText("Position linked by account and instrument identity"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Already linked" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Open Journal" }).click();
  await expect(
    page.getByRole("button", { name: "Journal", exact: true }),
  ).toHaveClass(/active/);
  await expect(
    page.locator('[data-journal-trade-id="journal-msft-review"]'),
  ).toBeFocused();
  await expect(
    page.getByText(/Historical fills and initial risk are unavailable/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Plan & Position", exact: true }).click();
  await page.getByRole("button", { name: "Open position", exact: true }).click();
  let position = page.getByRole("dialog", { name: "MSFT position details" });
  await expect(position).toContainText("12 unprotected");
  await expect(position).toContainText("Filled entry");
  await expect(position).toContainText("Unavailable");
  await expect(position).toContainText(/Current quantity and average entry come only from the identified position snapshot/);
  await position.getByRole("button", { name: "Draft amendment" }).click();
  await expect(position.getByText("Unapplied amendment draft", { exact: true })).toBeVisible();
  await expect(position).toContainText(/Execution R is unavailable/);
  await position.getByLabel("Amendment Runner A activation R").fill("1.75");
  await position.getByRole("button", { name: "Save amendment draft" }).click();
  await expect(position.getByRole("status").last()).toContainText("Unapplied amendment saved");
  await page.keyboard.press("Escape");
  await page.reload();
  await navigateTo(page, "Trading");
  await expect(page.getByRole("button", { name: "Already linked" })).toBeDisabled();
  await page.getByRole("button", { name: "Open position", exact: true }).click();
  position = page.getByRole("dialog", { name: "MSFT position details" });
  await position.getByRole("button", { name: "Reopen amendment" }).click();
  await expect(position.getByLabel("Amendment Runner A activation R")).toHaveValue("1.75");
});

test("creating a Journal record from a position snapshot persists without inferred fills", async ({ page }) => {
  await openDemo(page);
  await navigateTo(page, "Trading");
  await page.getByRole("button", { name: "Link or create record" }).click();
  await page.getByRole("dialog", { name: "Link MSFT position" })
    .getByRole("button", { name: "Create Journal record" }).click();
  await expect(page.getByText(/Journal record created and linked/)).toBeVisible();
  await page.getByRole("button", { name: "Open Journal" }).click();
  const focused = page.locator('[data-journal-trade-id^="journal-unlinked-msft-"]');
  await expect(focused).toBeFocused();
  await expect(page.getByText(/Historical fills and initial risk are unavailable/)).toBeVisible();
  await expect(page.getByText("entry · entry")).toHaveCount(0);
  await page.reload();
  await navigateTo(page, "Trading");
  await expect(page.getByRole("button", { name: "Already linked" })).toBeDisabled();
  await page.getByRole("button", { name: "Open Journal" }).click();
  await expect(page.locator('[data-journal-trade-id^="journal-unlinked-msft-"]')).toHaveCount(1);
});

test("mobile workspaces do not create document-level horizontal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemo(page);
  for (const workspace of ["Discover", "Charts", "Strategies", "Trading"]) {
    await navigateTo(
      page,
      workspace as "Discover" | "Charts" | "Strategies" | "Trading",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  }
  for (const selector of [
    ".trade-rule-panel",
    ".trade-leg-list",
    ".trade-preset-panel",
  ])
    await expectContained(page, selector, true);
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await expect(
    page.getByText("Swipe horizontally to review all trade metrics."),
  ).toBeVisible();
  const table = page.getByRole("region", {
    name: /Recent trades; scroll vertically/,
  });
  await expectContainedScroller(page, ".trade-table");
  await table.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => table.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
});

test("positions sit beside the planner when wide and stack on the same loaded page when compact", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await openDemo(page);
  await navigateTo(page, "Trading");
  await page.evaluate(
    () =>
      ((
        window as Window & { __positionResizeSentinel?: string }
      ).__positionResizeSentinel = crypto.randomUUID()),
  );
  const planner = page.locator(".trade-planner");
  const positions = page.locator(".position-command-center");
  const wide = await Promise.all([
    planner.boundingBox(),
    positions.boundingBox(),
  ]);
  expect(wide[0]).not.toBeNull();
  expect(wide[1]).not.toBeNull();
  expect(wide[1]!.x).toBeGreaterThanOrEqual(wide[0]!.x + wide[0]!.width - 1);
  await expectContained(page, ".position-command-center", true);

  await page.setViewportSize({ width: 1280, height: 760 });
  const compact = await Promise.all([
    planner.boundingBox(),
    positions.boundingBox(),
  ]);
  expect(compact[1]!.y).toBeGreaterThanOrEqual(
    compact[0]!.y + compact[0]!.height - 1,
  );
  await expectContained(page, ".position-command-center", true);
  await page
    .getByRole("button", { name: "Open AAPL position details" })
    .click();
  await expectContained(page, ".position-detail-drawer", true);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1800, height: 900 });
  await expect
    .poll(() =>
      positions.evaluate((element) => element.getBoundingClientRect().x),
    )
    .toBeGreaterThan(700);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __positionResizeSentinel?: string })
          .__positionResizeSentinel,
    ),
  ).toBeTruthy();
});

test("Trading tab geometry remains fixed while repeatedly switching views", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openDemo(page);
  await navigateTo(page, "Trading");

  const workspace = page.locator(".workspace");
  const tabBar = page.getByRole("navigation", { name: "Trading views" });
  const plan = page.getByRole("button", {
    name: "Plan & Position",
    exact: true,
  });
  const journal = page.getByRole("button", { name: "Journal", exact: true });
  const baseline = {
    workspace: await geometry(workspace),
    tabBar: await geometry(tabBar),
    plan: await geometry(plan),
    journal: await geometry(journal),
    divider: await dividerGeometry(page),
  };

  for (let index = 0; index < 3; index += 1) {
    await journal.click();
    await workspace.evaluate((element) => element.scrollTo(0, 0));
    if (index === 0 && process.env.BRONTIDE_CAPTURE_LAYOUT === "1") {
      await page.screenshot({
        path: "output/playwright/two-defect-ui-pass/after-tabs-1280x720.png",
      });
    }
    expectGeometryWithin(await geometry(workspace), baseline.workspace);
    expectGeometryWithin(await geometry(tabBar), baseline.tabBar);
    expectGeometryWithin(await geometry(plan), baseline.plan);
    expectGeometryWithin(await geometry(journal), baseline.journal);
    expectGeometryWithin(await dividerGeometry(page), baseline.divider);

    await plan.click();
    await workspace.evaluate((element) => element.scrollTo(0, 0));
    expectGeometryWithin(await geometry(workspace), baseline.workspace);
    expectGeometryWithin(await geometry(tabBar), baseline.tabBar);
    expectGeometryWithin(await geometry(plan), baseline.plan);
    expectGeometryWithin(await geometry(journal), baseline.journal);
    expectGeometryWithin(await dividerGeometry(page), baseline.divider);
  }
});

test("Journal stays within viewport and clipping bounds through wide-narrow-wide resizing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDemo(page);
  await navigateTo(page, "Trading");
  await page.getByRole("button", { name: "Journal", exact: true }).click();

  const chartSizes: Array<{ width: number; height: number }> = [];
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1225, height: 669 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      )
      .toEqual(viewport);
    if (
      viewport.width === 1225 &&
      process.env.BRONTIDE_CAPTURE_LAYOUT === "1"
    ) {
      await page.screenshot({
        path: "output/playwright/two-defect-ui-pass/after-journal-1225x669.png",
      });
    }

    for (const selector of [
      ".journal-content",
      ".header-actions",
      ".topbar .range-control:not(.compact-filter)",
      ".auth-button",
      ".topbar .primary-button",
      ".journal-metric-grid",
      ".equity-panel",
      ".distribution-panel",
      ".equity-chart svg",
      ".distribution-chart svg",
      ".lower-grid",
      ".trades-panel",
      ".setup-panel",
    ]) {
      await expectContained(page, selector, true);
    }

    const panelContentWidth = await page
      .locator(".equity-panel")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          element.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight)
        );
      });
    const chartSize = await page
      .locator(".equity-chart svg")
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
    expect(
      Math.abs(panelContentWidth - chartSize.width),
      `panel content ${panelContentWidth}, chart ${chartSize.width}`,
    ).toBeLessThanOrEqual(1);
    chartSizes.push(chartSize);
  }

  expect(chartSizes[1].width).toBeLessThan(chartSizes[0].width);
  expect(chartSizes[1].height).toBeLessThan(chartSizes[0].height);
  expect(
    Math.abs(chartSizes[2].width - chartSizes[0].width),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(chartSizes[2].height - chartSizes[0].height),
  ).toBeLessThanOrEqual(1);
});

test("Plan stays container-bound through a large-to-small per-monitor DPI transition", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openDemo(page);
  await navigateTo(page, "Trading");
  const cdp = await context.newCDPSession(page);

  const states = [
    { width: 1600, height: 900, deviceScaleFactor: 1 },
    { width: 1225, height: 669, deviceScaleFactor: 1.5 },
    { width: 1600, height: 900, deviceScaleFactor: 1 },
  ];
  for (const state of states) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      ...state,
      mobile: false,
    });
    await expect
      .poll(() =>
        page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
        })),
      )
      .toEqual({
        width: state.width,
        height: state.height,
        dpr: state.deviceScaleFactor,
      });
    const workspaceSizing = await page
      .locator(".workspace")
      .evaluate((element) => ({
        clientWidth: element.clientWidth,
        observedWidth: Number(element.getAttribute("data-layout-inline-size")),
        cssWidth: parseFloat(
          getComputedStyle(element).getPropertyValue("--workspace-inline-size"),
        ),
      }));
    expect(workspaceSizing.observedWidth).toBe(workspaceSizing.clientWidth);
    expect(workspaceSizing.cssWidth).toBe(workspaceSizing.clientWidth);
    for (const selector of [
      ".trading-tabs",
      ".simulation-ribbon",
      ".trade-commandbar",
      ".trade-risk-banner",
      ".trade-actionbar",
      ".paper-intent-readiness",
      ".trade-ticket:not(.trade-after-fill-ticket)",
      ".trade-session-panel",
      ".trade-after-fill-ticket",
      ".trade-rule-panel",
      ".trade-leg-list",
      ".trade-preset-panel",
      ".trade-safety-note",
      ".position-command-center",
    ]) {
      await expectContained(page, selector, true);
    }
    if (
      state.deviceScaleFactor === 1.5 &&
      process.env.BRONTIDE_CAPTURE_LAYOUT === "1"
    ) {
      await page.screenshot({
        path: "output/playwright/two-defect-ui-pass/after-plan-dpi-1225x669-at-1.5x.png",
      });
    }
  }
  await cdp.send("Emulation.clearDeviceMetricsOverride");
});

test("paper execution readiness distinguishes saved planning from validation and keeps submission approval-locked", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDemo(page);
  await navigateTo(page, "Trading");
  const readiness = page.getByRole("region", { name: "Intent readiness" });
  await expect(readiness).toContainText("Save the plan");
  const submit = page.getByRole("button", { name: "Submit paper order" });
  await expect(submit).toBeDisabled();
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page.getByRole("button", { name: "Validate paper intent" }).click();
  await expect(readiness).toContainText("Simulated prerequisite check passed");
  await expect(readiness).toContainText("Validated intent");
  await expect(readiness).toContainText("fresh ask");
  await expect(submit).toBeDisabled();
  await page.getByLabel("Captured planning entry price").fill("121");
  await expect(readiness).toContainText("Plan changed");
  await expect(page.getByRole("button", { name: "Validate paper intent" })).toBeDisabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectContained(page, ".paper-intent-readiness", true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectContained(page, ".paper-intent-readiness", true);
});

test("planner persists explicit session, duration and protection choices without enabling unsupported overnight orders", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDemo(page);
  await navigateTo(page, "Trading");
  const session = page.getByLabel("Trading session");
  const duration = page.getByLabel("Order duration");
  const protection = page.getByLabel("Protection order type");
  const summary = page.locator("#trade-session-summary");
  await expect(session).toHaveValue("Regular");
  await expect(duration).toHaveValue("DAY");
  await expect(page.getByText("MIDPRICE · SMART", { exact: true })).toBeVisible();

  await session.selectOption("RegularExtended");
  await expect(page.getByText("LMT · SMART", { exact: true })).toBeVisible();
  await expect(summary).toContainText("require explicit stop-limit protection");
  await protection.selectOption("STP LMT");
  await page.getByLabel("Protection limit price").fill("97.50");
  await duration.selectOption("GTC");
  await expect(summary).toContainText("broker-confirmed");
  await expect(summary).toContainText("may remain unfilled");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page.reload();
  await expect(session).toHaveValue("RegularExtended");
  await expect(duration).toHaveValue("GTC");
  await expect(protection).toHaveValue("STP LMT");
  await expect(page.getByLabel("Protection limit price")).toHaveValue("97.5");
  await page.getByRole("button", { name: "Validate paper intent" }).click();
  await expect(page.getByRole("region", { name: "Intent readiness" })).toContainText("Simulated prerequisite check passed");

  await page.getByRole("button", { name: "Unsave plan", exact: true }).click();
  await session.selectOption("Overnight");
  await expect(duration.locator("option")).toHaveCount(1);
  await expect(summary).toContainText("planning-only");
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page.getByRole("button", { name: "Validate paper intent" }).click();
  await expect(page.getByRole("region", { name: "Intent readiness" })).toContainText("broker-held initial stop protection");
  await expect(page.getByRole("button", { name: "Submit paper order" })).toBeDisabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectContained(page, ".trade-session-panel", true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectContained(page, ".trade-session-panel", true);
});

test("Journal campaign persistence keeps one row through partial entry, exit and closure", async ({ page }) => {
  await openDemo(page);
  await navigateTo(page, "Trading");
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  const key = "brontide-demo-review:brontide-journal-campaigns-v1";
  const base = {
    schemaVersion: 1, campaignId: "ui-lifecycle", journalTradeId: "ui-journal-lifecycle",
    accountId: "SIMULATED-ONLY", planId: "ui-plan", symbol: "UIFLOW", direction: "Long",
    lifecycle: { status: "Partially filled" },
    journalSnapshot: { instrumentId: "US-STK-UIFLOW", currency: "USD", setup: "EP breakout", provenance: "Linked plan", plannedEntry: 100, plannedQuantity: 40, originalStop: 98, plannedInitialRisk: 80, plannedTargets: [{ label: "T1", allocationPercent: 100, multipleR: 2 }], costsComplete: true, riskComplete: true },
  };
  const entry = { schemaVersion: 1, accountId: "SIMULATED-ONLY", sessionId: "ui-session", executionId: "entry", orderId: "o1", campaignId: "ui-lifecycle", effect: "entry", role: "entry", quantity: 40, price: 100, fee: .5, occurredAt: "2026-09-08T14:00:00Z", protectionStopAtFill: 98, provenance: "IBKR" };
  const exit1 = { ...entry, executionId: "exit1", orderId: "o2", effect: "exit", role: "target", quantity: 10, price: 104, fee: .5, occurredAt: "2026-09-08T15:00:00Z", protectionStopAtFill: undefined };
  const exit2 = { ...exit1, executionId: "exit2", orderId: "o3", role: "stop", quantity: 30, price: 99, occurredAt: "2026-09-08T16:00:00Z" };
  const persist = async (executions: unknown[], status: string) => page.evaluate(({ key, campaign }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, value: [campaign] }));
  }, { key, campaign: { ...base, lifecycle: { status }, executions, feeAdjustments: status === "Closed" ? [{ adjustmentId: "late", amount: .5, occurredAt: "2026-09-08T17:00:00Z", provenance: "IBKR" }] : [] } });

  await persist([entry], "Partially filled");
  await page.reload();
  let row = page.locator('[data-journal-trade-id="ui-journal-lifecycle"]');
  await expect(row).toHaveCount(1); await expect(row).toContainText("Open");
  await persist([exit1, entry], "Closing");
  await page.reload();
  row = page.locator('[data-journal-trade-id="ui-journal-lifecycle"]');
  await expect(row).toHaveCount(1); await expect(row).toContainText("Partially exited"); await expect(row).toContainText("+$39");
  await persist([exit2, entry, exit1, exit1], "Closed");
  await page.reload();
  row = page.locator('[data-journal-trade-id="ui-journal-lifecycle"]');
  await expect(row).toHaveCount(1); await expect(row).toContainText("Closed"); await expect(row).toContainText("+$8"); await expect(row).toContainText("+0.10R");
  await row.getByRole("button", { name: "UIFLOW" }).click();
  const detail = page.getByRole("region", { name: "UIFLOW entry and exit details" });
  await expect(detail).toContainText("40 / 40 / 0"); await expect(detail).toContainText("$10"); await expect(detail).toContainText("$2");
  await page.reload();
  await expect(page.locator('[data-journal-trade-id="ui-journal-lifecycle"]')).toHaveCount(1);
});

test("Journal metrics share one semantic card system and Recent trades keeps a measured scroll viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDemo(page);
  await navigateTo(page, "Trading");
  await page.getByRole("button", { name: "Journal", exact: true }).click();

  const cards = page.locator(".journal-metric-grid .metric-card");
  const metricLayout = () => page.locator(".journal-metric-grid").evaluate((grid) => {
    const cards = [...grid.querySelectorAll<HTMLElement>(".metric-card")];
    const rowTops = [...new Set(cards.map(card => Math.round(card.getBoundingClientRect().top)))];
    const content = grid.closest<HTMLElement>(".journal-content")!;
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      contentWidth: content.clientWidth - parseFloat(getComputedStyle(content).paddingLeft) - parseFloat(getComputedStyle(content).paddingRight),
      contained: cards.every(card => {
        const bounds = card.getBoundingClientRect();
        return [...card.querySelectorAll<HTMLElement>(".metric-label,.metric-value")].every(item => {
          const itemBounds = item.getBoundingClientRect();
          return itemBounds.left >= bounds.left - 1 && itemBounds.right <= bounds.right + 1 && itemBounds.bottom <= bounds.bottom + 1;
        });
      }),
      rows: rowTops.length,
      horizontalOverflow: grid.scrollWidth - grid.clientWidth,
    };
  });
  await expect(cards).toHaveCount(12);
  await expect(cards.locator(":scope > .metric-label")).toHaveCount(12);
  await expect(cards.locator(":scope > .metric-value")).toHaveCount(12);
  await expect(cards.locator(":scope > .metric-detail")).toHaveCount(12);
  await expect(cards.locator(".metric-label")).toHaveText([
    "Net P&L", "Win rate", "Avg planned R:R", "Expectancy in R", "Profit factor",
    "Closed", "Avg result", "Avg win", "Avg loss", "Payoff", "Max drawdown",
    "Longest loss streak",
  ]);
  await expect(cards.filter({ hasText: "Net P&L" })).toHaveAttribute("data-metric-tone", "positive");
  await expect(cards.filter({ hasText: "Avg win" })).toHaveAttribute("data-metric-tone", "positive");
  await expect(cards.filter({ hasText: "Avg loss" })).toHaveAttribute("data-metric-tone", "negative");
  await expect(cards.filter({ hasText: "Max drawdown" })).toHaveAttribute("data-metric-tone", "negative");
  await expect(cards.filter({ hasText: "Win rate" })).toHaveAttribute("data-metric-tone", "neutral");
  let layout = await metricLayout();
  expect(layout.contentWidth).toBeGreaterThanOrEqual(960);
  expect(layout.columns).toBe(6);
  expect(layout.rows).toBe(2);
  expect(layout.contained).toBe(true);
  expect(layout.horizontalOverflow).toBeLessThanOrEqual(1);
  const eligibility = page.getByLabel("Journal eligibility summary");
  await expect(eligibility).toContainText("excluded as open or incomplete");
  await expect(cards.filter({ hasText: "Excluded" })).toHaveCount(0);

  const table = page.getByRole("region", { name: /Recent trades; scroll vertically/ });
  const rows = table.locator(".trade-row:not(.table-head)");
  expect(await rows.count()).toBeGreaterThanOrEqual(30);
  await expect(table).toHaveAttribute("data-visible-rows", "10");
  const initial = await table.evaluate((element) => {
    const header = element.querySelector<HTMLElement>(".table-head")!;
    const rows = [...element.querySelectorAll<HTMLElement>(".trade-row:not(.table-head)")];
    const bounds = element.getBoundingClientRect();
    return {
      clientHeight: element.clientHeight,
      headerTop: header.getBoundingClientRect().top,
      tenthBottom: rows[9].getBoundingClientRect().bottom,
      eleventhBottom: rows[10].getBoundingClientRect().bottom,
      tableBottom: bounds.bottom,
    };
  });
  expect(Math.abs(initial.tenthBottom - initial.tableBottom)).toBeLessThanOrEqual(1);
  expect(initial.eleventhBottom).toBeGreaterThan(initial.tableBottom + 1);

  await table.focus();
  const focusedHeaderTop = await table.locator(".table-head").evaluate(element => element.getBoundingClientRect().top);
  await page.keyboard.press("PageDown");
  await expect.poll(() => table.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const stickyTop = await table.locator(".table-head").evaluate(element => element.getBoundingClientRect().top);
  expect(Math.abs(stickyTop - focusedHeaderTop)).toBeLessThanOrEqual(1);
  await table.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const lastRow = rows.last();
  await expect(lastRow).toBeVisible();
  const atBottom = await table.evaluate((element) => {
    const last = element.querySelector<HTMLElement>(".journal-trade-group:last-child .trade-row")!;
    return {
      lastBottom: last.getBoundingClientRect().bottom,
      tableBottom: element.getBoundingClientRect().bottom,
    };
  });
  expect(atBottom.lastBottom).toBeLessThanOrEqual(atBottom.tableBottom + 1);
  await lastRow.getByRole("button").click();
  await expect(table.locator(".journal-execution-details")).toBeVisible();
  expect(await table.evaluate(element => element.clientHeight)).toBe(initial.clientHeight);

  const unavailableR = rows.filter({ hasText: "MSFT" }).locator(":scope > span").nth(7);
  await expect(unavailableR).toHaveText("Unavailable");
  await expect(unavailableR).toHaveClass(/journal-semantic-unavailable/);

  for (const state of [
    { viewport: { width: 1050, height: 760 }, columns: 4, min: 720, max: 960 },
    { viewport: { width: 800, height: 760 }, columns: 3, min: 540, max: 720 },
    { viewport: { width: 390, height: 844 }, columns: 2, min: 340, max: 540 },
    { viewport: { width: 320, height: 700 }, columns: 1, min: 0, max: 340 },
  ]) {
    await page.setViewportSize(state.viewport);
    await expect.poll(async () => (await metricLayout()).columns).toBe(state.columns);
    layout = await metricLayout();
    expect(layout.contentWidth).toBeGreaterThanOrEqual(state.min);
    expect(layout.contentWidth).toBeLessThan(state.max);
    expect(layout.contained).toBe(true);
    expect(layout.horizontalOverflow).toBeLessThanOrEqual(1);
  }
  await expectContainedScroller(page, ".trade-table");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(table).toHaveAttribute("data-visible-rows", "10");
  await expect.poll(async () => (await metricLayout()).columns).toBe(6);
  layout = await metricLayout();
  expect(layout.rows).toBe(2);
  expect(layout.contained).toBe(true);
});

test("Journal filters, drawdown, review persistence and expanded rows remain responsive", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDemo(page);
  await navigateTo(page, "Trading");
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByLabel("Setup cohort").selectOption({ label: "EP breakout" });
  await page.getByLabel("Direction cohort").selectOption("Long");
  await page.getByLabel("Trade row status").selectOption("closed");
  await expect(page.locator('[data-journal-trade-id="journal-amd"]')).toBeVisible();
  await page.getByRole("button", { name: "Drawdown", exact: true }).click();
  await expect(page.getByRole("img", { name: /drawdown within selected period/i })).toBeVisible();
  await page.locator('[data-journal-trade-id="journal-amd"] button').click();
  await page.getByLabel("AMD Market suitable?").selectOption("Partly");
  await page.getByLabel("AMD Emotional state").selectOption("Calm");
  await page.getByLabel("AMD One lesson").fill("Wait for confirmation.");
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText("Review saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-journal-trade-id="journal-amd"]')).toContainText("Reviewed");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-journal-trade-id="journal-amd"] button').click();
  await expectContained(page, ".journal-execution-details", true);
  await expectContainedScroller(page, ".trade-table");
});
