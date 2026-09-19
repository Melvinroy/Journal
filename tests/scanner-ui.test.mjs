import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/ScannerDashboard.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const taskInstaller = readFileSync(new URL("../services/eod/scripts/register-eod-task.ps1", import.meta.url), "utf8");
const scheduledRunner = readFileSync(new URL("../services/eod/scripts/run-scheduled-update.ps1", import.meta.url), "utf8");

test("Discover exposes Scanner between existing Scans and Catalysts", () => {
  const discover = page.slice(page.indexOf('aria-label="Discover views"'), page.indexOf('aria-label="Trading views"'));
  assert.ok(discover.indexOf("Scans") < discover.indexOf("Scanner"));
  assert.ok(discover.indexOf("Scanner") < discover.indexOf("Catalysts"));
});

test("Biggest One Month renders exactly the requested result columns", () => {
  const header = source.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/)?.[1] ?? "";
  assert.equal((header.match(/<th/g) ?? []).length, 3);
  assert.match(header, /Symbol/);
  assert.match(header, />DV /);
  assert.match(header, /Day %/);
  assert.doesNotMatch(header, /1M gain/);
});

test("Scanner labels its published session as the EOD date", () => {
  assert.match(source, /EOD \$\{payload\.data_date\}/);
  assert.doesNotMatch(source, /Data through \$\{payload\.data_date\}/);
});

test("Scanner displays signed daily change while retaining growth only for selection diagnostics", () => {
  assert.match(source, /day_percent/);
  assert.match(source, /split-adjusted close for this EOD session versus the previous completed session/);
  assert.match(source, /growth_percent/);
  assert.match(source, /Approximate ranking/);
});

test("Scanner never substitutes sample results when the local service is absent", () => {
  assert.match(source, /No demo results are substituted/);
  assert.doesNotMatch(source, /demoRows|sampleRows|fixtureRows/);
  assert.match(source, /No matches for these thresholds/);
});

test("Scanner exposes sanitized recent EOD update history", () => {
  assert.match(source, /Update details/);
  assert.match(source, /Recent EOD updates/);
  assert.match(source, /adjustment coverage/);
  assert.doesNotMatch(source, /LogPath|readFileSync|provider response body/);
});

test("EOD task starts once after the US close and delegates bounded retries", () => {
  assert.match(taskInstaller, /-Weekly/);
  assert.match(taskInstaller, /Tuesday,Wednesday,Thursday,Friday,Saturday/);
  assert.match(taskInstaller, /-At '05:45'/);
  assert.match(taskInstaller, /AllowStartIfOnBatteries/);
  assert.match(taskInstaller, /DontStopIfGoingOnBatteries/);
  assert.match(taskInstaller, /DisallowHardTerminate/);
  assert.doesNotMatch(taskInstaller, /RepetitionInterval/);
  assert.match(scheduledRunner, /scheduled-update/);
});
