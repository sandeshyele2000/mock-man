import type {
  Config,
  Endpoint,
  Feature,
  Project,
  Response,
  Scenario,
} from "./api";

type Entity = { id: string; version?: number; metadataVersion?: number };
type Value = Project | Feature | Endpoint | Response | Scenario;
type Difference<T> = { before?: T; after?: T; id: string };
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function differences<T extends Entity>(
  before: T[],
  after: T[],
): Difference<T>[] {
  const old = new Map(before.map((v) => [v.id, v])),
    next = new Map(after.map((v) => [v.id, v]));
  return [...new Set([...old.keys(), ...next.keys()])]
    .filter(
      (id) => old.get(id) !== next.get(id) && !equal(old.get(id), next.get(id)),
    )
    .map((id) => ({ id, before: old.get(id), after: next.get(id) }));
}
function fields(value: Entity, omit: string[]): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => !["version", "metadataVersion", ...omit].includes(key),
    ),
  );
}
type Change = {
  kind: "response" | "scenario";
  id: string;
  version: number;
  value?: Response | Scenario;
  delete?: boolean;
};
export type WorkspaceChange = {
  path: string;
  method: "PUT" | "PATCH" | "DELETE" | "POST";
  body: {
    version: number;
    ancestors?: Record<string, number>;
    metadataVersion?: number;
    value?: Value | Record<string, unknown>;
    changes?: Change[];
    active?: Record<string, string>;
  };
  projectID: string;
  project?: Project;
  featureID?: string;
  endpointID?: string;
  responseID?: string;
  scenarioID?: string;
};
type EntityVersion = {
  version?: number;
  metadataVersion?: number;
  revision?: string;
};
export type WorkspaceChangeResult = {
  stale?: boolean;
  version: number;
  workspaceVersion: number;
  value?: Value;
  versions?: Record<string, EntityVersion>;
  revisions?: Record<string, string>;
};

function planChange(
  before: Config,
  after: Config,
): WorkspaceChange | undefined {
  const projects = differences(before.projects, after.projects);
  if (!projects.length) return;
  if (projects.length !== 1)
    throw new Error("Save changes to one project at a time.");
  const project = projects[0];
  const plan: WorkspaceChange = {
    projectID: project.id,
    project: project.after,
    path: `/api/projects/${encodeURIComponent(project.id)}`,
    method: "PUT",
    body: { version: project.before?.version ?? 0, value: project.after },
  };
  const choose = (
    change: Difference<Value>,
    segment: string,
    key: "featureID" | "endpointID" | "responseID" | "scenarioID",
  ) => {
    plan[key] = change.id;
    plan.path += `/${segment}/${encodeURIComponent(change.id)}`;
    plan.body = { version: change.before?.version ?? 0, value: change.after };
    plan.method = change.after ? "PUT" : "DELETE";
  };
  const patch = (value: Entity, old: Entity, omit: string[]) => {
    plan.method = "PATCH";
    plan.body = {
      version: old.metadataVersion ?? old.version ?? 0,
      value: fields(value, omit),
    };
  };
  if (!project.after) {
    plan.method = "DELETE";
    delete plan.body.value;
    return plan;
  }
  if (!project.before) return plan;
  const features = differences(project.before.features, project.after.features);
  if (!features.length) {
    patch(project.after, project.before, ["features"]);
    return plan;
  }
  if (
    !equal(
      fields(project.before, ["features"]),
      fields(project.after, ["features"]),
    ) ||
    features.length !== 1
  )
    return plan;
  const feature = features[0];
  choose(feature, "features", "featureID");
  if (!feature.before || !feature.after) return plan;
  const endpoints = differences(
    feature.before.endpoints,
    feature.after.endpoints,
  );
  if (!endpoints.length) {
    patch(feature.after, feature.before, ["endpoints"]);
    return plan;
  }
  if (
    !equal(
      fields(feature.before, ["endpoints"]),
      fields(feature.after, ["endpoints"]),
    ) ||
    endpoints.length !== 1
  )
    return plan;
  const endpoint = endpoints[0];
  choose(endpoint, "endpoints", "endpointID");
  if (!endpoint.before || !endpoint.after) return plan;
  const responses = differences(
    endpoint.before.responses,
    endpoint.after.responses,
  );
  const scenarios = differences(
    endpoint.before.scenarios,
    endpoint.after.scenarios,
  );
  if (!responses.length && !scenarios.length) {
    patch(endpoint.after, endpoint.before, ["responses", "scenarios"]);
    return plan;
  }
  const metadataEqual = equal(
    fields(endpoint.before, ["responses", "scenarios"]),
    fields(endpoint.after, ["responses", "scenarios"]),
  );
  if (metadataEqual && responses.length === 1 && !scenarios.length) {
    choose(responses[0], "responses", "responseID");
    return plan;
  }
  if (metadataEqual && scenarios.length === 1 && !responses.length) {
    choose(scenarios[0], "scenarios", "scenarioID");
    return plan;
  }
  // Imports and scenario deletion can change references and active selections.
  // Send only the delta and commit all related rows atomically.
  if (
    equal(
      fields(endpoint.before, ["responses", "scenarios", "active"]),
      fields(endpoint.after, ["responses", "scenarios", "active"]),
    )
  ) {
    plan.path += "/changes";
    plan.method = "POST";
    const changes: Change[] = [
      ...responses.map((change) => ({ kind: "response" as const, ...change })),
      ...scenarios.map((change) => ({ kind: "scenario" as const, ...change })),
    ].map(({ kind, id, before, after }) => ({
      kind,
      id,
      version: before?.version ?? 0,
      value: after,
      delete: !after,
    }));
    plan.body = {
      version: endpoint.before.version ?? 0,
      changes,
      ...(!equal(endpoint.before.active, endpoint.after.active)
        ? { active: endpoint.after.active }
        : {}),
    };
  }
  return plan;
}
export function planWorkspaceChange(
  before: Config,
  after: Config,
): WorkspaceChange | undefined {
  const plan = planChange(before, after);
  if (!plan) return;
  const project = before.projects.find((p) => p.id === plan.projectID);
  const ancestors: Record<string, number> = {};
  if (project?.version) ancestors.project = project.version;
  const feature = project?.features.find((f) => f.id === plan.featureID);
  if (feature?.version) ancestors[`feature/${feature.id}`] = feature.version;
  const endpoint = feature?.endpoints.find((e) => e.id === plan.endpointID);
  if (endpoint?.version)
    ancestors[`endpoint/${endpoint.id}`] = endpoint.version;
  plan.body.ancestors = ancestors;
  if (plan.body.active && endpoint)
    plan.body.metadataVersion = endpoint.metadataVersion ?? endpoint.version;
  return plan;
}

export function applyWorkspaceChange(
  plan: WorkspaceChange,
  saved: WorkspaceChangeResult,
): Project | undefined {
  if (!plan.project) return;
  let project = structuredClone(plan.project);
  if (saved.value) {
    if (!plan.featureID) project = { ...project, ...(saved.value as Project) };
    else {
      const feature = project.features.find((f) => f.id === plan.featureID)!;
      if (!plan.endpointID) Object.assign(feature, saved.value);
      else {
        const endpoint = feature.endpoints.find(
          (e) => e.id === plan.endpointID,
        )!;
        if (plan.responseID) {
          const i = endpoint.responses.findIndex(
            (r) => r.id === plan.responseID,
          );
          endpoint.responses[i] = saved.value as Response;
        } else if (plan.scenarioID) {
          const i = endpoint.scenarios.findIndex(
            (s) => s.id === plan.scenarioID,
          );
          endpoint.scenarios[i] = saved.value as Scenario;
        } else Object.assign(endpoint, saved.value);
      }
    }
  }
  const apply = (key: string, entity: Entity & { revision?: string }) => {
    const version = saved.versions?.[key];
    if (version) Object.assign(entity, version);
  };
  apply("project", project);
  for (const feature of project.features) {
    apply(`feature/${feature.id}`, feature);
    for (const endpoint of feature.endpoints) {
      apply(`endpoint/${endpoint.id}`, endpoint);
      for (const response of endpoint.responses)
        apply(`response/${endpoint.id}/${response.id}`, response);
      for (const scenario of endpoint.scenarios) {
        apply(`scenario/${endpoint.id}/${scenario.id}`, scenario);
        if (endpoint.id === plan.endpointID && saved.revisions?.[scenario.id])
          scenario.revision = saved.revisions[scenario.id];
      }
    }
  }
  return project;
}

// Metadata forms may remain open while query data refreshes. Preserve current
// children and compare the form's original metadata token, not its refreshed tree.
export function mergeMetadataDraft<T extends Project | Feature | Endpoint>(
  current: T | undefined,
  draft: T,
  original: T | undefined,
): T {
  if (!original) {
    if (current)
      throw new Error(
        "This identifier already exists. Choose a different identifier.",
      );
    return draft;
  }
  if (
    !current ||
    draft.id !== original.id ||
    (current.metadataVersion ?? current.version) !==
      (original.metadataVersion ?? original.version)
  ) {
    throw new Error(
      "This item changed while the editor was open. Close and reopen the editor before saving.",
    );
  }
  const merged = { ...current, name: draft.name };
  if ("features" in draft)
    return { ...merged, environments: draft.environments } as T;
  if ("endpoints" in draft) return merged as T;
  return { ...merged, method: draft.method, path: draft.path } as T;
}
