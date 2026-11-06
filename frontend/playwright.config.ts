// Created by Sandesh
import { defineConfig, devices } from "@playwright/test";
import { serverConfig } from "../scripts/config.mjs";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: serverConfig.dashboardOrigin,
    actionTimeout: 10000,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "go run ./cmd/mockman",
      cwd: "../backend",
      url: `${serverConfig.adminOrigin}/api/config`,
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      command: "npm run dev -- --strictPort",
      cwd: ".",
      url: serverConfig.dashboardOrigin,
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
  ],
});
