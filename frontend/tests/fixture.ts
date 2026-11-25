import type { Config } from "../src/api";

export const fixture: Config = {
  version: 1,
  projects: [
    {
      id: "demo",
      version: 1,
      name: "Demo application",
      environments: ["development", "staging"],
      features: [
        {
          id: "agreements",
          name: "Agreements",
          endpoints: [
            {
              id: "accept",
              name: "Accept agreement",
              method: "POST",
              path: "/v1/agreements/acceptances",
              enabled: true,
              responses: [
                {
                  id: "success",
                  name: "Agreement accepted",
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                  body: { success: true },
                  delayMs: 200,
                },
                {
                  id: "failure",
                  name: "Temporary failure",
                  status: 503,
                  headers: { "Content-Type": "application/json" },
                  body: { error: "Please try again" },
                  delayMs: 500,
                },
              ],
              scenarios: [
                {
                  id: "always",
                  name: "Always accept",
                  revision: "1",
                  behavior: "always",
                  count: 0,
                  responseIds: ["success"],
                  exhaustion: "repeat",
                  priority: 0,
                  conditions: [],
                },
              ],
              active: { development: "always", staging: "always" },
            },
          ],
        },
      ],
    },
  ],
};

// Assign entity tokens to the fixture as the real API does.
for (const p of fixture.projects) {
  p.metadataVersion = p.version = 1;
  for (const f of p.features) {
    f.metadataVersion = f.version = 1;
    for (const e of f.endpoints) {
      e.metadataVersion = e.version = 1;
      for (const r of e.responses) r.version = 1;
      for (const s of e.scenarios) s.version = 1;
    }
  }
}

// Minimal API fixture; PostgreSQL tests cover validation and concurrency.
export async function fulfillProjectMutation(
  route: import("@playwright/test").Route,
  config: Config,
): Promise<boolean> {
  const path = new URL(route.request().url()).pathname,
    start = path.indexOf("/api/projects/");
  if (start < 0) return false;
  const parts = path
    .slice(start + "/api/projects/".length)
    .split("/")
    .map(decodeURIComponent);
  const batch = parts.at(-1) === "changes";
  if (batch) parts.pop();
  const { version, value, changes, active } = route.request().postDataJSON();
  const method = route.request().method();
  let values: { id: string; version?: number; metadataVersion?: number }[] =
    config.projects;
  for (let i = 1; i < parts.length; i += 2) {
    const parent = values.find((v) => v.id === parts[i - 1])!;
    values = (parent as unknown as Record<string, typeof values>)[parts[i]];
  }
  const index = values.findIndex((v) => v.id === parts.at(-1)),
    current = values[index];
  const expected =
    method === "PATCH" ? current?.metadataVersion : current?.version;
  if (version !== (expected ?? 0)) {
    await route.fulfill({
      status: 409,
      json: { error: "entity changed; reload before saving" },
    });
    return true;
  }
  if (batch) {
    const endpoint = current as import("../src/api").Endpoint;
    for (const change of changes) {
      const items =
        change.kind === "response" ? endpoint.responses : endpoint.scenarios;
      const i = items.findIndex((v) => v.id === change.id);
      if (change.delete) items.splice(i, 1);
      else if (i < 0) items.push(change.value);
      else items[i] = change.value;
    }
    if (active) endpoint.active = active;
  } else if (method === "DELETE") values.splice(index, 1);
  else if (method === "PATCH") Object.assign(current, value);
  else if (index < 0) values.push(value);
  else values[index] = value;
  config.version++;
  const versions: Record<
    string,
    { version: number; metadataVersion?: number; revision?: string }
  > = {};
  const p = config.projects.find((p) => p.id === parts[0]);
  if (p) {
    p.version = p.metadataVersion = config.version;
    versions.project = {
      version: p.version,
      metadataVersion: p.metadataVersion,
    };
    for (const f of p.features) {
      f.version = f.metadataVersion = config.version;
      versions[`feature/${f.id}`] = {
        version: f.version,
        metadataVersion: f.metadataVersion,
      };
      for (const e of f.endpoints) {
        e.version = e.metadataVersion = config.version;
        versions[`endpoint/${e.id}`] = {
          version: e.version,
          metadataVersion: e.metadataVersion,
        };
        for (const r of e.responses) {
          r.version = config.version;
          versions[`response/${e.id}/${r.id}`] = { version: r.version };
        }
        for (const s of e.scenarios) {
          s.version = config.version;
          versions[`scenario/${e.id}/${s.id}`] = {
            version: s.version,
            revision: s.revision,
          };
        }
      }
    }
  }
  await route.fulfill({
    json: {
      version: config.version,
      workspaceVersion: config.version,
      versions,
      value: !batch && ["PUT", "PATCH"].includes(method) ? value : undefined,
    },
    headers: { "Access-Control-Allow-Origin": "*" },
  });
  return true;
}
