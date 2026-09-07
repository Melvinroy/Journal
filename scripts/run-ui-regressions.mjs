import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const nextEnvPath = fileURLToPath(new URL("../next-env.d.ts", import.meta.url));
const originalNextEnv = readFileSync(nextEnvPath);
const playwrightCli = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url));
const child = spawn(process.execPath, [playwrightCli, "test", "--config", "playwright.ui.config.ts", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
});

let restored = false;
function restoreGeneratedTypeReferences() {
  if (restored) return;
  restored = true;
  writeFileSync(nextEnvPath, originalNextEnv);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  restoreGeneratedTypeReferences();
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
child.on("error", error => {
  restoreGeneratedTypeReferences();
  console.error(error.message);
  process.exit(1);
});
