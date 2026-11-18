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

// Public URLs and listen ports come from one root environment file.
const host = values.PUBLIC_HOST || "localhost";
const origin = (port) =>
  `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
export const serverConfig = {
  adminOrigin:
    values.ADMIN_ORIGIN ||
    (values.ADMIN_ADDR
      ? `http://${values.ADMIN_ADDR}`
      : origin(values.ADMIN_PORT || "8080")),
  mockOrigin:
    values.MOCK_ORIGIN ||
    (values.MOCK_ADDR
      ? `http://${values.MOCK_ADDR}`
      : origin(values.MOCK_PORT || "9091")),
  dashboardOrigin:
    values.DASHBOARD_ORIGIN || origin(values.DASHBOARD_PORT || "5173"),
  bindAddress: values.BIND_ADDRESS || "127.0.0.1",
};
