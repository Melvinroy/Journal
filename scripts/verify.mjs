import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const service = path.join(root, "services", "eod");
const python = path.join(service, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
const build = path.join(root, "scripts", "build.mjs");
const browserRunner = path.join(root, "scripts", "run-ui-regressions.mjs");
const isolatedRoot = mkdtempSync(path.join(tmpdir(), "brontide-verify-"));
const started = Date.now();
let completed = 0;

function fail(message, code = 1) {
  console.error(`\n[verify] FAIL: ${message}`);
  cleanup();
  process.exit(code || 1);
}

function cleanup() {
  const expectedParent = path.resolve(tmpdir());
  if (path.dirname(path.resolve(isolatedRoot)) === expectedParent && path.basename(isolatedRoot).startsWith("brontide-verify-")) {
    rmSync(isolatedRoot, { recursive: true, force: true });
  }
}

function requireFile(file, message) {
  if (!existsSync(file)) fail(message);
}

function capture(executable, args, options = {}) {
  return spawnSync(executable, args, { cwd: root, encoding: "utf8", ...options });
}

function runStage(label, executable, args, options = {}) {
  const stageStart = Date.now();
  console.log(`\n[verify] ${completed + 1}/5 ${label}`);
  const result = spawnSync(executable, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} exited with code ${result.status ?? "unknown"}.`, result.status ?? 1);
  completed += 1;
  console.log(`[verify] PASS ${label} (${((Date.now() - stageStart) / 1000).toFixed(1)}s)`);
}

requireFile(python, `EOD Python environment is missing at ${python}. Create it and install services/eod with its dev dependencies; see services/eod/README.md.`);
requireFile(tsc, "TypeScript is missing. Run npm install before npm run verify.");
requireFile(build, `Production build runner is missing at ${build}.`);
requireFile(browserRunner, `Browser regression runner is missing at ${browserRunner}.`);

const nodeParts = process.versions.node.split(".").map(Number);
if (nodeParts[0] < 20 || nodeParts[0] === 20 && nodeParts[1] < 9) fail(`Node ${process.versions.node} is unsupported; Next.js requires Node >=20.9.`);
const pythonProbe = capture(python, ["-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))"], { cwd: service });
if (pythonProbe.error || pythonProbe.status !== 0) fail(`Could not execute the EOD Python environment at ${python}: ${pythonProbe.error?.message ?? pythonProbe.stderr}`);
const pythonVersion = pythonProbe.stdout.trim();
const pythonParts = pythonVersion.split(".").map(Number);
if (pythonParts[0] < 3 || pythonParts[0] === 3 && pythonParts[1] < 11) fail(`EOD Python ${pythonVersion} is unsupported; services/eod requires Python >=3.11.`);
const pytestProbe = capture(python, ["-c", "import pytest; print(pytest.__version__)"], { cwd: service });
if (pytestProbe.error || pytestProbe.status !== 0) fail(`pytest is missing from ${python}. Install services/eod with its [dev] dependencies.`);

let chromium;
let chromiumPath;
let chromiumVersion;
try {
  ({ chromium } = await import("playwright"));
  chromiumPath = chromium.executablePath();
} catch (error) {
  fail(`Playwright is missing. Run npm install. ${error instanceof Error ? error.message : error}`);
}
if (!existsSync(chromiumPath)) fail(`Playwright Chromium is missing at ${chromiumPath}. Run npx playwright install chromium.`);
try {
  const browser = await chromium.launch({ headless: true });
  chromiumVersion = browser.version();
  await browser.close();
} catch (error) {
  fail(`Playwright Chromium could not be started at ${chromiumPath}. Reinstall it with: npx playwright install chromium. ${error instanceof Error ? error.message : error}`);
}

console.log("[verify] Journal local verification");
console.log(`[verify] Node ${process.versions.node} · ${process.execPath}`);
console.log(`[verify] EOD Python ${pythonVersion} · ${python}`);
console.log(`[verify] pytest ${pytestProbe.stdout.trim()} · Chromium ${chromiumVersion} · ${chromiumPath}`);
console.log(`[verify] Backend isolation ${isolatedRoot}`);
console.log("[verify] Lint is not configured and is not part of this command.");

const backendEnv = {
  ...process.env,
  ALPACA_API_KEY: "verify-no-live-service",
  ALPACA_API_SECRET: "verify-no-live-service",
  BRONTIDE_DB_PATH: path.join(isolatedRoot, "verify.duckdb"),
  BRONTIDE_ALPACA_TRADING_BASE_URL: "http://127.0.0.1:9",
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  ALL_PROXY: "http://127.0.0.1:9",
  NO_PROXY: "127.0.0.1,localhost",
  PYTHONDONTWRITEBYTECODE: "1",
};

try {
  runStage("Node tests", process.execPath, ["--test", "tests/*.test.mjs"]);
  runStage("EOD backend tests", python, ["-m", "pytest", "-q"], { cwd: service, env: backendEnv });
  runStage("TypeScript", process.execPath, [tsc, "--noEmit"]);
  runStage("Browser regressions", process.execPath, [browserRunner]);
  runStage("Production build", process.execPath, [build]);
  cleanup();
  console.log(`\n[verify] PASS all 5 stages (${((Date.now() - started) / 1000).toFixed(1)}s).`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
