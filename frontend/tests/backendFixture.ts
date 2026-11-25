import type { APIRequestContext } from "@playwright/test";
import { serverConfig } from "../../scripts/config.mjs";
import { fixture } from "./fixture";
export async function seedWorkspace(request: APIRequestContext) {
  const current = await (
    await request.get(`${serverConfig.adminOrigin}/api/config`)
  ).json();
  if (current.projects.length) return;
  const result = await request.put(`${serverConfig.adminOrigin}/api/config`, {
    headers: { "Content-Type": "application/json", "X-Mockman-Admin": "1" },
    data: { ...fixture, version: current.version },
  });
  if (!result.ok())
    throw new Error(`Could not seed test workspace: ${await result.text()}`);
}
