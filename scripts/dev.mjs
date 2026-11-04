import { spawn } from "node:child_process";
import { serverConfig } from "./config.mjs";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const vite = fileURLToPath(
  new URL("../frontend/node_modules/vite/bin/vite.js", import.meta.url),
);
if (!existsSync(vite)) {
  console.error(
    "Frontend dependencies are missing. Run npm install at the project root first.",
  );
  process.exit(1);
}

const children = new Set();
let stopping = false;
let exitCode = 0;
let forceStop;

function signal(child, name) {
  try {
    // Process groups include the server binary launched by go run.
    if (process.platform !== "win32") process.kill(-child.pid, name);
    else child.kill(name);
  } catch (error) {
    if (error.code !== "ESRCH") console.error(error.message);
  }
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const child of children) signal(child, "SIGTERM");
  forceStop = setTimeout(() => {
    for (const child of children) signal(child, "SIGKILL");
  }, 6000);
  forceStop.unref();
}

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    detached: process.platform !== "win32",
    ...options,
  });
  children.add(child);
  child.on("error", (error) => {
    console.error(`${name}: ${error.message}`);
    stop(1);
  });
  child.on("close", (code, signalName) => {
    children.delete(child);
    if (!stopping) {
      console.error(
        `${name} stopped (${signalName ?? code}). Stopping both servers.`,
      );
      stop(code || 1);
    }
    if (children.size === 0) {
      clearTimeout(forceStop);
      process.exitCode = exitCode;
    }
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

console.log(
  `Dashboard: ${serverConfig.dashboardOrigin} | Backend: ${serverConfig.adminOrigin} | Mock API: ${serverConfig.mockOrigin}`,
);
start("Backend", "go", ["-C", "backend", "run", "./cmd/mockman"]);
start("Frontend", process.execPath, [vite], {
  cwd: fileURLToPath(new URL("../frontend/", import.meta.url)),
});
