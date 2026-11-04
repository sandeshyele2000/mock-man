import type { components, paths } from "./schema";
import { API_BASE_URL } from "./config";
export type Config = components["schemas"]["Config"];
export type Project = components["schemas"]["Project"];
export type Feature = components["schemas"]["Feature"];
export type Endpoint = components["schemas"]["Endpoint"];
export type Response = components["schemas"]["Response"];
export type Scenario = components["schemas"]["Scenario"];
export type Condition = components["schemas"]["Condition"];
export type Log = components["schemas"]["Log"];
export type TryRequest = components["schemas"]["TryRequest"];
export type TryResult = components["schemas"]["TryResult"];
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch(new URL(path, API_BASE_URL), {
    method,
    headers: { "Content-Type": "application/json", "X-Mockman-Admin": "1" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || `Request failed (${r.status})`);
  return data;
}
export const loadConfig = () =>
  api<
    paths["/api/config"]["get"]["responses"][200]["content"]["application/json"]
  >("/api/config");
