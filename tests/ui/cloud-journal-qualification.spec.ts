import { test, expect, type Page, type Route } from "@playwright/test";
import type { CloudTradeRow } from "../../lib/cloud-trade-contract";

type Input = Omit<CloudTradeRow, "id">;
type Outcome = "success" | "rejected" | "lost" | "missing" | "partial" | "wrong";
const accountA = "00000000-0000-0000-0000-000000000001";
const accountB = "00000000-0000-0000-0000-000000000002";
const authKey = "sb-brontide-test-auth-token";
const backupKey = "journal-trades-v2";
const draftKey = `brontide-cloud-trade-draft-v1:${accountA}`;
const sessionFor = (id: string) => ({
  access_token: `artificial-token-${id}`, refresh_token: `artificial-refresh-${id}`,
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer",
  user: { id, email: `${id}@example.test`, aud: "authenticated", email_confirmed_at: new Date().toISOString() },
});
const localTrades = ["FIRST", "SECOND"].map((symbol, i) => ({id:`local-${i}`,symbol,side:"Long",setup:"Momentum breakout",date:new Date().toISOString().slice(0,10),pnl:6,r:1.5,risk:4,plannedR:2,grade:"A"}));
const backup = JSON.stringify(localTrades);

async function fixture(page: Page, options: { import?: boolean; outcome?: Outcome; delay?: boolean } = {}) {
  let posts = 0;
  const reads: string[] = [];
  const history = new Map<string, CloudTradeRow[]>();
  let pending: Route | undefined;
  const reply = async (route: Route, outcome: Outcome) => {
    const body = route.request().postDataJSON() as Input | Input[];
    const rows = (Array.isArray(body) ? body : [body]).map((row, i) => ({...row,id:`ack-${i}`}));
    if (outcome === "rejected") return route.fulfill({status:403,json:{code:"42501",message:"Artificial rejection"}});
    // Lost acknowledgments can follow a committed write. History retry must
    // reveal the persisted records without submitting them for a second time.
    if (outcome !== "wrong") {
      history.set(route.request().headers().authorization ?? "", outcome === "partial" ? rows.slice(0,1) : rows);
    }
    if (outcome === "lost") return route.abort("connectionreset");
    if (outcome === "missing") return route.fulfill({json:Array.isArray(body) ? [] : null});
    if (outcome === "partial") return route.fulfill({json:rows.slice(0,1)});
    if (outcome === "wrong") return route.fulfill({json:Array.isArray(body) ? rows.map(row => ({...row,symbol:"WRONG"})) : {...rows[0],symbol:"WRONG"}});
    return route.fulfill({json:Array.isArray(body) ? rows : rows[0]});
  };
  await page.route(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/v1\//, r => r.fulfill({status:503,json:{detail:"Artificial qualification: execution unavailable"}}));
  await page.route("https://brontide-test.supabase.co/**", async route => {
    if (route.request().url().includes("/rest/v1/trades")) {
      if (route.request().method() === "GET") {
        reads.push(route.request().headers().authorization ?? "");
        return route.fulfill({json:history.get(route.request().headers().authorization ?? "") ?? []});
      }
      posts++;
      if (options.delay) { pending = route; return; }
      return reply(route, options.outcome ?? "success");
    }
    return route.fulfill({json:sessionFor(accountA).user});
  });
  await page.addInitScript(({session,authKey,backupKey,backup}) => {
    if (sessionStorage.getItem("cloud-qualification-seeded")) return;
    localStorage.setItem(authKey, JSON.stringify(session));
    if (backup) localStorage.setItem(backupKey, backup);
    sessionStorage.setItem("cloud-qualification-seeded", "1");
  }, {session:sessionFor(accountA),authKey,backupKey,backup:options.import ? backup : null});
  await page.goto("/?paper=1");
  await journal(page);
  await expect.poll(() => reads.length).toBeGreaterThan(0);
  return {
    posts: () => posts, reads,
    release: async (outcome: Outcome = "success") => { expect(pending).toBeDefined(); await reply(pending!, outcome); },
  };
}

async function journal(page: Page) {
  await page.getByRole("button", {name:"Journal",exact:true}).click();
  await expect(page.getByRole("button", {name:"Log trade",exact:true})).toBeEnabled();
}
async function submitDraft(page: Page) {
  await page.getByRole("button", {name:"Log trade",exact:true}).click();
  const dialog = page.getByRole("dialog", {name:"Log a trade"});
  await dialog.getByLabel("Symbol", {exact:true}).fill("RECOVER");
  await dialog.getByLabel("Dollar risk", {exact:true}).fill("4");
  await dialog.getByLabel("Planned reward", {exact:true}).fill("2");
  await dialog.getByLabel("Final P&L", {exact:true}).fill("6");
  await dialog.getByRole("button", {name:"Save trade",exact:true}).click();
}
async function changeSession(page: Page, id: string) {
  await page.evaluate(({key,session}) => {
    localStorage.setItem(key, JSON.stringify(session));
    const channel = new BroadcastChannel(key);
    channel.postMessage({event:"SIGNED_IN",session});
    channel.close();
  }, {key:authKey,session:sessionFor(id)});
}

for (const outcome of ["success", "rejected", "lost", "missing", "wrong"] as const) {
  test(`manual save ${outcome}: acknowledgment, retained draft, and no automatic resubmission`, async ({page}) => {
    const cloud = await fixture(page, {outcome});
    await submitDraft(page);
    const dialog = page.getByRole("dialog", {name:"Log a trade"});
    if (outcome === "success") {
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('[data-journal-trade-id="ack-0"]')).toContainText("RECOVER");
      expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBeNull();
    } else {
      await expect(dialog.getByRole("alert")).toContainText(/preserved|unknown|acknowledged/i);
      await expect(dialog.getByLabel("Symbol", {exact:true})).toHaveValue("RECOVER");
      await dialog.getByRole("button", {name:"Close",exact:true}).click();
      const before = cloud.reads.length;
      await page.getByRole("button", {name:"Retry cloud history",exact:true}).click();
      await expect.poll(() => cloud.reads.length).toBeGreaterThan(before);
      if (outcome === "lost" || outcome === "missing") {
        await expect(page.locator('[data-journal-trade-id="ack-0"]')).toContainText("RECOVER");
      }
      await page.reload();
      await journal(page);
      await page.getByRole("button", {name:"Log trade",exact:true}).click();
      await expect(dialog.getByLabel("Symbol", {exact:true})).toHaveValue("RECOVER");
      await expect(dialog).toContainText("an earlier attempt may already have succeeded");
    }
    expect(cloud.posts()).toBe(1);
  });
}

for (const outcome of ["success", "rejected", "lost", "missing", "partial", "wrong"] as const) {
  test(`import ${outcome}: backup survives uncertainty and history retry never writes`, async ({page}) => {
    const cloud = await fixture(page, {import:true,outcome});
    await page.getByRole("button", {name:"Import browser trades",exact:true}).click();
    if (outcome === "success") {
      await expect(page.locator('[data-journal-trade-id="ack-0"]')).toContainText("FIRST");
      await expect(page.locator('[data-journal-trade-id="ack-1"]')).toContainText("SECOND");
      expect(await page.evaluate(key => localStorage.getItem(key), backupKey)).toBeNull();
    } else {
      await expect(page.locator(".cloud-notice.error")).toContainText(/preserved/i);
      expect(await page.evaluate(key => localStorage.getItem(key), backupKey)).toBe(backup);
      const before = cloud.reads.length;
      await page.getByRole("button", {name:"Retry cloud history",exact:true}).click();
      await expect.poll(() => cloud.reads.length).toBeGreaterThan(before);
      if (outcome === "lost" || outcome === "missing" || outcome === "partial") {
        await expect(page.locator('[data-journal-trade-id="ack-0"]')).toContainText("FIRST");
        await expect(page.locator('[data-journal-trade-id^="ack-"]')).toHaveCount(outcome === "partial" ? 1 : 2);
      }
      await page.reload();
      await journal(page);
      await expect(page.locator(".cloud-notice")).toContainText("A previous import has no confirmed result");
      expect(await page.evaluate(key => localStorage.getItem(key), backupKey)).toBe(backup);
    }
    expect(cloud.posts()).toBe(1);
  });
}

for (const importing of [false,true]) for (const returnToA of [false,true]) {
  test(`${importing ? "import" : "save"} delayed A → B${returnToA ? " → A" : ""} cannot apply an earlier session response`, async ({page}) => {
    const cloud = await fixture(page, {import:importing,delay:true});
    if (importing) await page.getByRole("button", {name:"Import browser trades",exact:true}).click();
    else await submitDraft(page);
    await expect.poll(cloud.posts).toBe(1);
    await changeSession(page,accountB);
    await expect.poll(() => cloud.reads.some(token => token.includes(accountB))).toBe(true);
    await expect(page.getByRole("dialog", {name:"Log a trade"})).toHaveCount(0);
    await page.getByRole("button", {name:"Log trade",exact:true}).click();
    await expect(page.getByRole("dialog").getByLabel("Symbol", {exact:true})).toHaveValue("");
    await page.getByRole("dialog").getByRole("button", {name:"Close",exact:true}).click();
    if (returnToA) {
      const before = cloud.reads.length;
      await changeSession(page,accountA);
      await expect.poll(() => cloud.reads.slice(before).some(token => token.includes(accountA))).toBe(true);
    }
    await cloud.release();
    await expect(page.getByRole("button", {name:"Log trade",exact:true})).toBeEnabled();
    await expect(page.locator('[data-journal-trade-id^="ack-"]')).toHaveCount(0);
    expect(await page.evaluate(key => localStorage.getItem(key), importing ? backupKey : draftKey)).not.toBeNull();
    expect(cloud.posts()).toBe(1);
  });
}

test("repeated sign-in notification keeps the pending save active", async ({page}) => {
  const cloud = await fixture(page, {delay:true});
  await submitDraft(page);
  await expect.poll(cloud.posts).toBe(1);
  await changeSession(page,accountA);
  await cloud.release();
  await expect(page.getByRole("dialog", {name:"Log a trade"})).toHaveCount(0);
  await expect(page.locator('[data-journal-trade-id="ack-0"]')).toContainText("RECOVER");
  expect(cloud.posts()).toBe(1);
});

test("a newer local backup is retained after an older import is acknowledged", async ({page}) => {
  const cloud = await fixture(page, {import:true,delay:true});
  await page.getByRole("button", {name:"Import browser trades",exact:true}).click();
  await expect.poll(cloud.posts).toBe(1);
  const newer = JSON.stringify([...localTrades,{...localTrades[0],id:"newer",symbol:"NEWER"}]);
  await page.evaluate(({key,raw}) => localStorage.setItem(key,raw), {key:backupKey,raw:newer});
  await cloud.release();
  await expect(page.locator(".cloud-notice")).toContainText("newer local backup was preserved");
  expect(await page.evaluate(key => localStorage.getItem(key), backupKey)).toBe(newer);
});

test("confirmed import remains confirmed when local backup cleanup fails", async ({page}) => {
  const cloud = await fixture(page, {import:true,delay:true});
  await page.getByRole("button", {name:"Import browser trades",exact:true}).click();
  await expect.poll(cloud.posts).toBe(1);
  await page.evaluate(key => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (name: string) {
      if (name === key) throw new DOMException("Artificial cleanup denial", "SecurityError");
      return original.call(this,name);
    };
  }, backupKey);
  await cloud.release();
  await expect(page.locator(".cloud-notice.error")).toContainText("Import confirmed. Local backup cleanup could not be completed");
  await expect(page.locator('[data-journal-trade-id^="ack-"]')).toHaveCount(2);
  await expect(page.getByRole("button", {name:"Import browser trades",exact:true})).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), backupKey)).toBe(backup);
  await page.reload();
  await journal(page);
  await expect(page.locator('[data-journal-trade-id^="ack-"]')).toHaveCount(2);
  expect(cloud.posts()).toBe(1);
});


test("cloud recovery warning leaves Save reachable at mobile width and doubled text", async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  const cloud = await fixture(page, {outcome:"missing"});
  await submitDraft(page);
  const dialog = page.getByRole("dialog", {name:"Log a trade"});
  const warning = dialog.getByRole("alert");
  const save = dialog.getByRole("button", {name:"Save trade",exact:true});
  await expect(warning).toContainText("Your draft is preserved");
  await save.click({trial:true});
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll<HTMLElement>("body *")]
      .map(element => ({element,size:parseFloat(getComputedStyle(element).fontSize)}));
    for (const {element,size} of sizes) if (size) element.style.fontSize = `${size * 2}px`;
  });
  await warning.scrollIntoViewIfNeeded();
  await expect(warning).toBeVisible();
  await save.click({trial:true});
  const uncovered = await save.evaluate(element => {
    const r = element.getBoundingClientRect();
    const top = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return top === element || element.contains(top);
  });
  expect(uncovered).toBe(true);
  expect(cloud.posts()).toBe(1);
  await dialog.getByRole("button", {name:"Close",exact:true}).press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", {name:"Log trade",exact:true})).toBeFocused();
});
