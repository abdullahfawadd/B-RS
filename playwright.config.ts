import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const baseURL = process.env.BRS_E2E_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 160_000,
  workers: 1,
  reporter: "list",
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure", viewport: { width: 1440, height: 1000 } },
  webServer: process.env.BRS_E2E_URL ? undefined : {
    command: "node node_modules/next/dist/bin/next dev -p 3000",
    url: baseURL, timeout: 120_000, reuseExistingServer: true,
  },
});
