// Created by Sandesh
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { projectRoot, serverConfig } from "../scripts/config.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, "");
  const dashboard = new URL(serverConfig.dashboardOrigin);
  return {
    plugins: [react(), tailwindcss()],
    envDir: projectRoot,
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(
        env.VITE_API_URL || serverConfig.adminOrigin,
      ),
      "import.meta.env.VITE_MOCK_URL": JSON.stringify(
        env.VITE_MOCK_URL || serverConfig.mockOrigin,
      ),
    },
    server: {
      host: dashboard.hostname,
      port: Number(
        dashboard.port || (dashboard.protocol === "https:" ? 443 : 80),
      ),
      strictPort: true,
    },
  };
});
