import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const browserPath = process.env.CHROMIUM_EXECUTABLE ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const environment = {
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? "/workspace/.config",
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? "/workspace/.cache",
  NEXT_TELEMETRY_DISABLED: "1",
  WRANGLER_SEND_METRICS: "false",
};

export default defineConfig({
  testDir: "./tests/ui",
  outputDir: ".playwright/results",
  reporter: [["list"], ["html", { outputFolder: ".playwright/report", open: "never" }]],
  workers: 1,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 20000 },
  use: {
    locale: "zh-TW", headless: true, screenshot: "only-on-failure", trace: "retain-on-failure",
    launchOptions: { executablePath: browserPath },
  },
  projects: [
    { name: "demo-desktop", use: { baseURL: "http://127.0.0.1:3050", viewport: { width: 1280, height: 900 } } },
    { name: "demo-mobile", use: { baseURL: "http://127.0.0.1:3050", viewport: { width: 390, height: 844 } } },
    { name: "real-desktop", use: { baseURL: "http://127.0.0.1:3051", viewport: { width: 1280, height: 900 } } },
    { name: "real-mobile", use: { baseURL: "http://127.0.0.1:3051", viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    { command: "npm run start -- --hostname 127.0.0.1 --port 3050", url: "http://127.0.0.1:3050", env: { ...environment, REAL_DATA: "false" }, reuseExistingServer: false },
    { command: "npm run start -- --hostname 127.0.0.1 --port 3051", url: "http://127.0.0.1:3051", env: { ...environment, REAL_DATA: "true" }, reuseExistingServer: false },
  ],
});
