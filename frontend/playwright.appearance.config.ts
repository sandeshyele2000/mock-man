import { defineConfig } from "@playwright/test";
import config from "./playwright.config";
import { serverConfig } from "../scripts/config.mjs";

// These tests mock all API calls and do not require a running database/backend.
export default defineConfig({
  ...config,
  testMatch: "appearance.spec.ts",
  webServer: {
    command: "npm run dev -- --strictPort",
    cwd: ".",
    url: serverConfig.dashboardOrigin,
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
