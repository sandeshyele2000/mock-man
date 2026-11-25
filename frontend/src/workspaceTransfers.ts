import type { Feature, Response, Scenario } from "./api";
import { generateId } from "./id";
import { behaviors } from "./scenarioBehaviors";
export function exportScenario(scenario: Scenario, responses: Response[]) {
  const responseIDs = new Set([
    ...scenario.responseIds,
    ...(scenario.flow?.nodes.flatMap((node) =>
      node.responseId ? [node.responseId] : [],
    ) ?? []),
  ]);
  const bundle = {
    format: "mockman-scenario",
    version: 1,
    scenario: { ...scenario, revision: "" },
    responses: responses.filter(
      (response) =>
        scenario.behavior === "flow" || responseIDs.has(response.id),
    ),
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "scenario"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
export function exportFeature(feature: Feature) {
  const bundle = {
    format: "mockman-feature",
    version: 1,
    feature,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${feature.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "feature"}.mockman-feature.json`;
  link.click();
  URL.revokeObjectURL(url);
}
export async function readFeatureImport(
  file: File,
  environments: string[],
  maxBytes = 100 * 1024 * 1024,
): Promise<Feature> {
  if (file.size > maxBytes)
    throw new Error(
      `Feature file must be at most ${maxBytes / 1024 / 1024} MiB.`,
    );
  const bundle = JSON.parse(await file.text());
  const feature = bundle?.feature as Feature | undefined;
  if (
    bundle?.format !== "mockman-feature" ||
    bundle?.version !== 1 ||
    !feature?.id ||
    !feature.name ||
    !Array.isArray(feature.endpoints)
  ) {
    throw new Error("This file is not a supported Mockman feature export.");
  }
  const createIDMap = (values: string[], label: string) => {
    if (
      values.some((value) => !value) ||
      new Set(values).size !== values.length
    ) {
      throw new Error(`The export contains missing or duplicate ${label} IDs.`);
    }
    return new Map(values.map((value) => [value, generateId()]));
  };
  const requireMappedID = (
    ids: Map<string, string>,
    value: string,
    label: string,
  ) => {
    const mapped = ids.get(value);
    if (!mapped)
      throw new Error(
        `The export references an unknown ${label} ID: ${value}.`,
      );
    return mapped;
  };
  const endpointIDs = createIDMap(
    feature.endpoints.map((endpoint) => endpoint.id),
    "endpoint",
  );
  const importedFeature: Feature = {
    ...feature,
    id: generateId(),
    endpoints: feature.endpoints.map((endpoint) => {
      const responseIDs = createIDMap(
        endpoint.responses.map((response) => response.id),
        "response",
      );
      const scenarioIDs = createIDMap(
        endpoint.scenarios.map((scenario) => scenario.id),
        "scenario",
      );
      return {
        ...endpoint,
        id: requireMappedID(endpointIDs, endpoint.id, "endpoint"),
        responses: endpoint.responses.map((response) => ({
          ...response,
          id: requireMappedID(responseIDs, response.id, "response"),
        })),
        scenarios: endpoint.scenarios.map((scenario) => {
          const nodeIDs = createIDMap(
            scenario.flow?.nodes.map((node) => node.id) ?? [],
            "flow node",
          );
          const connectionIDs = createIDMap(
            scenario.flow?.connections.map((connection) => connection.id) ?? [],
            "flow connection",
          );
          return {
            ...scenario,
            id: requireMappedID(scenarioIDs, scenario.id, "scenario"),
            revision: "",
            responseIds: scenario.responseIds.map((id) =>
              requireMappedID(responseIDs, id, "response"),
            ),
            ...(scenario.code
              ? {
                  code: [...responseIDs].reduce(
                    (code, [oldID, newID]) =>
                      code
                        .replaceAll(
                          JSON.stringify(oldID),
                          JSON.stringify(newID),
                        )
                        .replaceAll(`'${oldID}'`, `'${newID}'`),
                    scenario.code,
                  ),
                }
              : {}),
            ...(scenario.flow
              ? {
                  flow: {
                    ...scenario.flow,
                    startNodeId: requireMappedID(
                      nodeIDs,
                      scenario.flow.startNodeId,
                      "flow node",
                    ),
                    nodes: scenario.flow.nodes.map((node) => ({
                      ...node,
                      id: requireMappedID(nodeIDs, node.id, "flow node"),
                      ...(node.responseId
                        ? {
                            responseId: requireMappedID(
                              responseIDs,
                              node.responseId,
                              "response",
                            ),
                          }
                        : {}),
                      ...(node.code
                        ? {
                            code: [...responseIDs].reduce(
                              (code, [oldID, newID]) =>
                                code
                                  .replaceAll(
                                    JSON.stringify(oldID),
                                    JSON.stringify(newID),
                                  )
                                  .replaceAll(`'${oldID}'`, `'${newID}'`),
                              node.code,
                            ),
                          }
                        : {}),
                    })),
                    connections: scenario.flow.connections.map(
                      (connection) => ({
                        ...connection,
                        id: requireMappedID(
                          connectionIDs,
                          connection.id,
                          "flow connection",
                        ),
                        source: requireMappedID(
                          nodeIDs,
                          connection.source,
                          "flow node",
                        ),
                        target: requireMappedID(
                          nodeIDs,
                          connection.target,
                          "flow node",
                        ),
                      }),
                    ),
                  },
                }
              : {}),
          };
        }),
        active: Object.fromEntries(
          Object.entries(endpoint.active)
            .filter(([environment]) => environments.includes(environment))
            .map(([environment, scenarioID]) => [
              environment,
              requireMappedID(scenarioIDs, scenarioID, "scenario"),
            ]),
        ),
      };
    }),
  };

  return importedFeature;
}
export async function readScenarioImport(
  file: File,
  maxBytes = 100 * 1024 * 1024,
): Promise<{ scenario: Scenario; responses: Response[] }> {
  if (file.size > maxBytes)
    throw new Error(
      `Scenario file must be at most ${maxBytes / 1024 / 1024} MiB.`,
    );
  const bundle = JSON.parse(await file.text());
  const scenario = bundle?.scenario as Scenario | undefined;
  const responses = bundle?.responses as Response[] | undefined;
  if (
    bundle?.format !== "mockman-scenario" ||
    bundle?.version !== 1 ||
    !scenario ||
    (!Object.hasOwn(behaviors, scenario.behavior) &&
      scenario.behavior !== "flow") ||
    !Array.isArray(scenario.responseIds) ||
    !Array.isArray(responses) ||
    !Array.isArray(scenario.conditions) ||
    (scenario.behavior === "flow" && !scenario.flow)
  ) {
    throw new Error("This file is not a supported Mockman scenario export.");
  }
  const ids = new Map<string, string>();
  const importedResponses = responses.map((response) => {
    if (
      !response?.id ||
      ids.has(response.id) ||
      !response.name ||
      !response.headers
    ) {
      throw new Error("The export contains an invalid or duplicate response.");
    }
    const importedID = generateId();
    ids.set(response.id, importedID);
    return { ...response, id: importedID };
  });
  const importedScenario: Scenario = {
    ...scenario,
    id: generateId(),
    revision: "",
    ...(scenario.code
      ? {
          code: [...ids].reduce(
            (code, [oldID, newID]) =>
              code
                .replaceAll(JSON.stringify(oldID), JSON.stringify(newID))
                .replaceAll(`'${oldID}'`, `'${newID}'`),
            scenario.code,
          ),
        }
      : {}),
    responseIds: scenario.responseIds.map((responseID) => {
      const mapped = ids.get(responseID);
      if (!mapped)
        throw new Error(`The export is missing response ${responseID}.`);
      return mapped;
    }),
    ...(scenario.flow
      ? {
          flow: {
            ...scenario.flow,
            nodes: scenario.flow.nodes.map((node) => {
              if (node.type === "javascript" && node.code) {
                const code = [...ids].reduce(
                  (current, [original, mapped]) =>
                    current
                      .replaceAll(
                        JSON.stringify(original),
                        JSON.stringify(mapped),
                      )
                      .replaceAll(`'${original}'`, `'${mapped}'`),
                  node.code,
                );
                return { ...node, code };
              }
              if (node.type !== "response" || !node.responseId) return node;
              const mapped = ids.get(node.responseId);
              if (!mapped)
                throw new Error(
                  `The export is missing response ${node.responseId}.`,
                );
              return { ...node, responseId: mapped };
            }),
          },
        }
      : {}),
  };

  return { scenario: importedScenario, responses: importedResponses };
}
