// Created by Sandesh
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const envFile = new URL("../.env", import.meta.url);
const values = {
  ...(existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {}),
  ...process.env,
};

// Shared defaults for the frontend toolchain and development launcher.
const defaults = {
  adminAddress: "127.0.0.1:8080",
  mockAddress: "127.0.0.1:9091",
  dashboardOrigin: "http://localhost:5173",
};

export const serverConfig = {
  adminOrigin:
    values.ADMIN_ORIGIN ||
    `http://${values.ADMIN_ADDR || defaults.adminAddress}`,
  mockOrigin:
    values.MOCK_ORIGIN || `http://${values.MOCK_ADDR || defaults.mockAddress}`,
  dashboardOrigin: values.DASHBOARD_ORIGIN || defaults.dashboardOrigin,
};
