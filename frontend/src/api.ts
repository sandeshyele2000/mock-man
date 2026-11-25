// Created by Sandesh
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
  const r = await fetch(
    new URL(path.replace(/^\/+/, ""), `${API_BASE_URL.replace(/\/+$/, "")}/`),
    {
      method,
      headers: { "Content-Type": "application/json", "X-Mockman-Admin": "1" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
  );
  const data = await r.json().catch(() => undefined);
  if (!r.ok)
    throw Error(
      data?.error ||
        (r.status === 413
          ? "Upload exceeds the server or proxy size limit."
          : `Request failed (${r.status})`),
    );
  if (data === undefined)
    throw Error(
      "Server returned invalid JSON; check the API URL and proxy configuration.",
    );
  return data;
}
export const loadConfig = () =>
  api<
    paths["/api/config"]["get"]["responses"][200]["content"]["application/json"]
  >("/api/config");
