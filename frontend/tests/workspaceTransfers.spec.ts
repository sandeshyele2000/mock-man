import { expect, test } from "@playwright/test";
import {
  readFeatureImport,
  readScenarioImport,
} from "../src/workspaceTransfers";
import { fixture } from "./fixture";

const file = (value: unknown) =>
  new File([JSON.stringify(value)], "export.json", {
    type: "application/json",
  });

test("feature imports remap linked IDs, scripts, flow graphs and active environments", async () => {
  const original = structuredClone(fixture.projects[0].features[0]);
  const endpoint = original.endpoints[0];
  endpoint.scenarios[0].code = 'return { responseId: "success" };';
  endpoint.scenarios[0].flow = {
    startNodeId: "start",
    nodes: [
      { id: "start", type: "start", x: 0, y: 0 },
      {
        id: "script",
        type: "javascript",
        x: 0,
        y: 100,
        code: "return { responseId: 'success' };",
      },
      { id: "result", type: "response", x: 0, y: 200, responseId: "success" },
    ],
    connections: [
      { id: "one", source: "start", target: "script" },
      { id: "two", source: "script", target: "result" },
    ],
  };
  const snapshot = structuredClone(original);
  const imported = await readFeatureImport(
    file({ format: "mockman-feature", version: 1, feature: original }),
    ["development"],
  );
  const result = imported.endpoints[0];
  const responseID = result.responses[0].id;
  expect(imported.id).not.toBe(original.id);
  expect(result.id).not.toBe(endpoint.id);
  expect(responseID).not.toBe("success");
  expect(result.scenarios[0].id).not.toBe("always");
  expect(result.scenarios[0].revision).toBe("");
  expect(result.scenarios[0].responseIds).toEqual([responseID]);
  expect(result.active).toEqual({ development: result.scenarios[0].id });
  expect(result.scenarios[0].code).toContain(JSON.stringify(responseID));
  const graph = result.scenarios[0].flow!;
  expect(graph.nodes[0].id).not.toBe("start");
  expect(graph.startNodeId).toBe(graph.nodes[0].id);
  expect(graph.nodes[1].code).toContain(`'${responseID}'`);
  expect(graph.nodes[2].responseId).toBe(responseID);
  expect(graph.connections[0].id).not.toBe("one");
  expect(graph.connections[0].source).toBe(graph.nodes[0].id);
  expect(graph.connections[0].target).toBe(graph.nodes[1].id);
  expect(graph.connections[1].target).toBe(graph.nodes[2].id);
  expect(original).toEqual(snapshot);
});

test("feature imports reject duplicate IDs, dangling references and oversized files", async () => {
  const feature = structuredClone(fixture.projects[0].features[0]);
  const bundle = { format: "mockman-feature", version: 1, feature };
  feature.endpoints[0].responses.push(
    structuredClone(feature.endpoints[0].responses[0]),
  );
  await expect(
    readFeatureImport(file(bundle), ["development"]),
  ).rejects.toThrow("duplicate response IDs");
  feature.endpoints[0].responses.pop();
  feature.endpoints[0].scenarios[0].responseIds = ["missing"];
  await expect(
    readFeatureImport(file(bundle), ["development"]),
  ).rejects.toThrow("unknown response ID: missing");
  await expect(
    readFeatureImport(
      new File([" ".repeat(2 * 1024 * 1024 + 1)], "large.json"),
      ["development"],
      2 * 1024 * 1024,
    ),
  ).rejects.toThrow("at most 2 MiB");
});

test("scenario imports remap response references and reject missing responses", async () => {
  const endpoint = structuredClone(
    fixture.projects[0].features[0].endpoints[0],
  );
  const scenario = {
    ...endpoint.scenarios[0],
    behavior: "javascript" as const,
    code: "return { responseId: 'success' };",
  };
  const bundle = {
    format: "mockman-scenario",
    version: 1,
    scenario,
    responses: endpoint.responses,
  };
  const imported = await readScenarioImport(file(bundle));
  expect(imported.scenario.id).not.toBe(scenario.id);
  expect(imported.scenario.revision).toBe("");
  expect(imported.scenario.responseIds).toEqual([imported.responses[0].id]);
  expect(imported.scenario.code).toContain(`'${imported.responses[0].id}'`);
  bundle.responses = [];
  await expect(readScenarioImport(file(bundle))).rejects.toThrow(
    "missing response success",
  );
  await expect(readScenarioImport(file({}))).rejects.toThrow(
    "not a supported Mockman scenario export",
  );
});
