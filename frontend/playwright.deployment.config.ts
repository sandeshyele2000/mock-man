import { defineConfig, devices } from "@playwright/test";

// Run against an already-built dashboard container or its reverse proxy.
export default defineConfig({
  testDir: "./tests",
  testMatch: "deployment.spec.ts",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: process.env.DEPLOYMENT_URL,
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
});
