import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const probe = fileURLToPath(new URL("./windows-ui-diagnostics.ps1", import.meta.url));

export function captureWindowsSnapshot(phase, run = spawnSync) {
  const result = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", probe,
    "-RootProcessId", String(process.pid), "-Phase", phase], {
    encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 256 * 1024,
  });
  // Never retain process stderr/exception messages: they can contain local paths.
  if (result.error || result.status !== 0) return { phase, unavailable: "probe failed or timed out" };
  try { return JSON.parse(result.stdout.replace(/^\uFEFF/, "")); }
  catch { return { phase, unavailable: "probe returned invalid JSON" }; }
}

export function createDiagnostics({ enabled, capture, save }) {
  let started = false, failed = false;
  function record(phase) {
    try { save(phase, capture(phase)); }
    catch { /* Diagnostics cannot override the test runner's result. */ }
  }
  return {
    begin() { if (enabled && !started) { started = true; record("before-tests"); } },
    endTest(result) {
      if (enabled && !failed && ["failed", "timedOut", "interrupted"].includes(result.status)) {
        failed = true; record("first-failure");
      }
    },
  };
}

export default class WindowsDiagnosticsReporter {
  constructor() {
    const directory = process.env.BRONTIDE_VERIFY_REPORT_DIR;
    this.diagnostics = createDiagnostics({
      enabled: process.platform === "win32" && process.env.BRONTIDE_UI_DIAGNOSTICS === "1" && Boolean(directory),
      capture: captureWindowsSnapshot,
      save(phase, snapshot) {
        mkdirSync(directory, { recursive: true });
        writeFileSync(path.join(directory, `windows-ui-${phase}.json`), JSON.stringify(snapshot, null, 2));
      },
    });
  }
  onBegin() { this.diagnostics.begin(); }
  onTestEnd(_test, result) { this.diagnostics.endTest(result); }
  printsToStdio() { return false; }
}
