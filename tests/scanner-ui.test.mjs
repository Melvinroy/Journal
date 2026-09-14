import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/ScannerDashboard.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("Discover exposes Scanner between existing Scans and Catalysts", () => {
  const discover = page.slice(page.indexOf('aria-label="Discover views"'), page.indexOf('aria-label="Trading views"'));
  assert.ok(discover.indexOf("Scans") < discover.indexOf("Scanner"));
  assert.ok(discover.indexOf("Scanner") < discover.indexOf("Catalysts"));
});

test("Biggest One Month renders exactly the requested result columns", () => {
  const header = source.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/)?.[1] ?? "";
  assert.equal((header.match(/<th/g) ?? []).length, 3);
  assert.match(header, /Symbol/);
  assert.match(header, /Dollar volume/);
  assert.match(header, /1M gain %/);
});

test("Scanner labels its published session as the EOD date", () => {
  assert.match(source, /EOD date \$\{payload\.data_date\}/);
  assert.doesNotMatch(source, /Data through \$\{payload\.data_date\}/);
});

test("Scanner never substitutes sample results when the local service is absent", () => {
  assert.match(source, /No demo results are substituted/);
  assert.doesNotMatch(source, /demoRows|sampleRows|fixtureRows/);
  assert.match(source, /No matches for these thresholds/);
});
