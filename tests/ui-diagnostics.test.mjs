import assert from "node:assert/strict";
import test from "node:test";
import { captureWindowsSnapshot, createDiagnostics } from "../scripts/ui-diagnostics-reporter.mjs";

test("diagnostics capture baseline and only first failure without changing results", () => {
  const phases = [];
  const saved = [];
  const diagnostics = createDiagnostics({ enabled: true,
    capture: phase => { phases.push(phase); return { phase }; },
    save: (phase, data) => saved.push([phase, data]),
  });
  diagnostics.begin(); diagnostics.begin();
  diagnostics.endTest({ status: "passed" }); diagnostics.endTest({ status: "skipped" });
  const failure = Object.freeze({ status: "timedOut", errors: ["original error"] });
  diagnostics.endTest(failure); diagnostics.endTest({ status: "failed" });
  assert.deepEqual(phases, ["before-tests", "first-failure"]);
  assert.equal(saved.length, 2);
  assert.deepEqual(failure, { status: "timedOut", errors: ["original error"] });
});

test("disabled diagnostics perform no IO and collection failures never mask test failure", () => {
  let calls = 0;
  const capture = () => { calls++; throw new Error("private-path"); };
  const save = () => { throw new Error("private-output-path"); };
  const disabled = createDiagnostics({ enabled: false, capture, save });
  disabled.begin(); disabled.endTest({ status: "failed" });
  assert.equal(calls, 0);
  const enabled = createDiagnostics({ enabled: true, capture, save });
  assert.doesNotThrow(() => { enabled.begin(); enabled.endTest({ status: "failed" }); });
  assert.equal(calls, 2);
  const brokenSave = createDiagnostics({ enabled: true, capture: () => ({}), save });
  assert.doesNotThrow(() => brokenSave.begin());
});

test("Windows probe is bounded and does not expose failed process output", () => {
  const snapshot = captureWindowsSnapshot("first-failure", (executable, args, options) => {
    assert.equal(executable, "powershell.exe");
    assert.equal(options.timeout, 15000);
    assert.equal(options.windowsHide, true);
    assert.equal(options.maxBuffer, 256 * 1024);
    assert.ok(args.includes("-NonInteractive"));
    assert.equal(args.at(-1), "first-failure");
    return { status: 0, stdout: '\ufeff{"phase":"first-failure"}' };
  });
  assert.deepEqual(snapshot, { phase: "first-failure" });
  for (const result of [
    { status: 1, stderr: "secret", stdout: "secret" },
    { error: new Error("private"), status: null },
    { status: 0, stdout: "private invalid JSON" },
  ]) {
    const resultText = JSON.stringify(captureWindowsSnapshot("before-tests", () => result));
    assert.doesNotMatch(resultText, /secret|private/);
    assert.match(resultText, /unavailable/);
  }
});
