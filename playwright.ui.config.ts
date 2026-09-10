import { defineConfig } from "@playwright/test";
import path from "node:path";
import { getPreviewIdentity } from "./scripts/preview-identity.mjs";

const port = 3107;
const previewIdentity = getPreviewIdentity(process.cwd());
process.env.BRONTIDE_EXPECTED_PREVIEW_ID ||= previewIdentity.identifier;
const serverEnv = { ...process.env, AI_AGENT: "", CODEX_SANDBOX: "", CODEX_CI: "", CODEX_THREAD_ID: "", NEXT_PUBLIC_BRONTIDE_UI_TEST_LOCAL: "1", NEXT_PUBLIC_BRONTIDE_PREVIEW_ID: process.env.BRONTIDE_EXPECTED_PREVIEW_ID };
const reportDirectory = process.env.BRONTIDE_VERIFY_REPORT_DIR;

export default defineConfig({
  testDir: "./tests/ui",
  testMatch: ["chart-regressions.spec.ts", "workspace-quality.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: reportDirectory
    ? [
        ["line"],
        ["html", { outputFolder: path.join(reportDirectory, "playwright-report"), open: "never" }],
        ["junit", { outputFile: path.join(reportDirectory, "playwright-junit.xml") }],
      ]
    : "line",
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
