import { defineConfig } from "@playwright/test";

const port = 3107;
const serverEnv = { ...process.env, AI_AGENT: "", CODEX_SANDBOX: "", CODEX_CI: "", CODEX_THREAD_ID: "" };

export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "chart-regressions.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  expect: { timeout: 10_000, toHaveScreenshot: { animations: "disabled", maxDiffPixels: 75 } },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    colorScheme: "light",
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/charts/`,
    env: serverEnv,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
