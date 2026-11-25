import { test, expect } from "@playwright/test";
import {
  planWorkspaceChange,
  mergeMetadataDraft,
  applyWorkspaceChange,
} from "../src/workspaceChanges";
import { fixture } from "./fixture";

const endpointPath = "/api/projects/demo/features/agreements/endpoints/accept";
test("response saves omit unrelated projects and responses and apply server revisions", () => {
  const before = structuredClone(fixture);
  const other = structuredClone(before.projects[0]);
  other.id = "unrelated";
  before.projects.push(other);
  const after = structuredClone(before);
  const endpoint = after.projects[0].features[0].endpoints[0];
  endpoint.responses[0].body = { updated: true };
  const plan = planWorkspaceChange(before, after)!;
  expect(plan.path).toBe(`${endpointPath}/responses/success`);
  expect(plan.body.version).toBe(1);
  expect(plan.body.value).toEqual(endpoint.responses[0]);
  expect(JSON.stringify(plan.body)).not.toContain("unrelated");
  expect(JSON.stringify(plan.body)).not.toContain("Temporary failure");
  const saved = applyWorkspaceChange(plan, {
    version: 2,
    workspaceVersion: 9,
    value: endpoint.responses[0],
    revisions: { always: "new-revision" },
    versions: {
      project: { version: 2, metadataVersion: 1 },
    },
  })!;
  expect(saved.version).toBe(2);
  expect(saved.features[0].endpoints[0].scenarios[0].revision).toBe(
    "new-revision",
  );
  expect(
    before.projects[0].features[0].endpoints[0].scenarios[0].revision,
  ).toBe("1");
});

test("scenario imports save their response dependencies together at endpoint scope", () => {
  const after = structuredClone(fixture);
  const endpoint = after.projects[0].features[0].endpoints[0];
  endpoint.responses.push({ ...endpoint.responses[0], id: "imported" });
  endpoint.scenarios[0].responseIds = ["imported"];
  const plan = planWorkspaceChange(fixture, after)!;
  expect(plan.path).toBe(endpointPath + "/changes");
  expect(plan.method).toBe("POST");
  expect(plan.body.value).toBeUndefined();
  expect(plan.body.changes).toHaveLength(2);
});

test("project creation and response deletion carry the correct version and scope", () => {
  const after = structuredClone(fixture);
  const project = {
    id: "new",
    name: "New project",
    features: [],
    environments: ["development"],
  };
  after.projects.push(project);
  expect(planWorkspaceChange(fixture, after)).toMatchObject({
    path: "/api/projects/new",
    method: "PUT",
    body: { version: 0, value: project },
  });
  const deletion = structuredClone(fixture);
  deletion.projects[0].features[0].endpoints[0].responses.pop();
  const plan = planWorkspaceChange(fixture, deletion)!;
  expect(plan.path).toBe(`${endpointPath}/responses/failure`);
  expect(plan.method).toBe("DELETE");
  expect(plan.body.value).toBeUndefined();
  const saved = applyWorkspaceChange(plan, {
    version: 2,
    workspaceVersion: 2,
  })!;
  expect(saved.features[0].endpoints[0].responses).toHaveLength(1);
  expect(
    planWorkspaceChange(fixture, structuredClone(fixture)),
  ).toBeUndefined();
});

test("large feature metadata uses a small PATCH and its metadata token", () => {
  const before = structuredClone(fixture);
  const feature = before.projects[0].features[0];
  feature.version = 9;
  feature.metadataVersion = 4;
  feature.endpoints[0].responses[0].body = {
    large: "x".repeat(3 * 1024 * 1024),
  };
  const after = structuredClone(before);
  after.projects[0].features[0].mockingDisabled = true;
  const plan = planWorkspaceChange(before, after)!;
  expect(plan.path).toBe("/api/projects/demo/features/agreements");
  expect(plan.method).toBe("PATCH");
  expect(plan.body.version).toBe(4);
  expect(JSON.stringify(plan.body).length).toBeLessThan(1024);
  const saved = applyWorkspaceChange(plan, {
    version: 10,
    workspaceVersion: 10,
    value: {
      id: feature.id,
      name: feature.name,
      mockingDisabled: true,
    } as typeof feature,
    versions: {
      project: { version: 10, metadataVersion: 1 },
      "feature/agreements": { version: 10, metadataVersion: 10 },
    },
  })!;
  expect(saved.features[0].endpoints[0].responses[0].body).toEqual(
    feature.endpoints[0].responses[0].body,
  );
  expect(saved.features[0].metadataVersion).toBe(10);
});

test("scenario edits never resend existing response payloads", () => {
  const before = structuredClone(fixture);
  before.projects[0].features[0].endpoints[0].responses[0].body = {
    large: "x".repeat(3 * 1024 * 1024),
  };
  const after = structuredClone(before);
  after.projects[0].features[0].endpoints[0].scenarios[0].name =
    "New scenario name";
  const plan = planWorkspaceChange(before, after)!;
  expect(plan.path).toBe(endpointPath + "/scenarios/always");
  expect(plan.method).toBe("PUT");
  expect(JSON.stringify(plan.body)).not.toContain('"large"');
  expect(JSON.stringify(plan.body).length).toBeLessThan(1024);
});

test("response saves do not advance unseen parent metadata or scenario content tokens", () => {
  const before = structuredClone(fixture),
    after = structuredClone(fixture);
  const endpoint = after.projects[0].features[0].endpoints[0];
  endpoint.responses[0].body = { updated: true };
  const plan = planWorkspaceChange(before, after)!;
  const saved = applyWorkspaceChange(plan, {
    version: 9,
    workspaceVersion: 9,
    value: endpoint.responses[0],
    versions: {
      project: { version: 9 },
      "feature/agreements": { version: 9 },
      "endpoint/accept": { version: 9 },
      "response/accept/success": { version: 9 },
    },
    revisions: { always: "new-runtime-revision" },
  })!;
  expect(saved.features[0].metadataVersion).toBe(1);
  expect(saved.features[0].endpoints[0].metadataVersion).toBe(1);
  expect(saved.features[0].endpoints[0].scenarios[0].version).toBe(1);
  expect(saved.features[0].endpoints[0].scenarios[0].revision).toBe(
    "new-runtime-revision",
  );
});

test("metadata editors preserve refreshed children and reject stale metadata", () => {
  const original = structuredClone(fixture.projects[0].features[0]);
  const draft = { ...structuredClone(original), name: "Edited name" };
  const current = structuredClone(original);
  current.version = 9;
  current.endpoints[0].responses[0].body = { concurrent: "new response body" };
  const merged = mergeMetadataDraft(current, draft, original);
  expect(merged.name).toBe("Edited name");
  expect(merged.endpoints[0].responses[0].body).toEqual({
    concurrent: "new response body",
  });
  current.metadataVersion = 10;
  expect(() => mergeMetadataDraft(current, draft, original)).toThrow(
    "changed while the editor was open",
  );
  expect(() => mergeMetadataDraft(undefined, draft, original)).toThrow(
    "changed while the editor was open",
  );
});

test("mutation baselines include ancestor and active-selection tokens", () => {
  const after = structuredClone(fixture),
    endpoint = after.projects[0].features[0].endpoints[0];
  const added = { ...endpoint.scenarios[0], id: "new-scenario" };
  endpoint.scenarios.push(added);
  endpoint.active.development = added.id;
  const plan = planWorkspaceChange(fixture, after)!;
  expect(plan.body.ancestors).toEqual({
    project: 1,
    "feature/agreements": 1,
    "endpoint/accept": 1,
  });
  expect(plan.body.metadataVersion).toBe(1);
  expect(plan.method).toBe("POST");
});
