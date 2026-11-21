import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const systemChrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 180000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:4175",
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
        (existsSync(systemChrome) ? systemChrome : undefined),
    },
  },
  webServer: {
    command: "npm run build && npm run preview -- --port 4175",
    url: "http://127.0.0.1:4175",
    timeout: 90000,
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
