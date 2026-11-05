import filter from "lodash/filter";
import find from "lodash/find";
import map from "lodash/map";
import type { Scenario } from "../../api";

export type FlowNodeType = "start" | "response" | "javascript" | "end";

export type FlowNode = {
  id: string;
  type: FlowNodeType;
  x: number;
  y: number;
  responseId?: string;
  code?: string;
  outputs?: string[];
};

export type FlowConnection = {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
};

export type FlowGraph = NonNullable<Scenario["flow"]>;

const makeId = () => crypto.randomUUID().slice(0, 8);

function connect(
  source: string,
  target: string,
  sourcePort = "",
): FlowConnection {
  return {
    id: makeId(),
    source,
    target,
    ...(sourcePort ? { sourcePort } : {}),
  };
}

export function createFlow(responseIds: string[], loop: boolean): FlowGraph {
  const responses = responseIds;
  const nodes: FlowNode[] = [
    { id: "start", type: "start", x: 32, y: 120 },
    ...responses.map((responseId, index) => ({
      id: makeId(),
      type: "response" as const,
      responseId,
      x: 290 + index * 250,
      y: 120,
    })),
    {
      id: "end",
      type: "end",
      x: 290 + responses.length * 250,
      y: 120,
    },
  ];
  const connections = nodes
    .slice(0, -1)
    .map((node, index) => connect(node.id, nodes[index + 1].id));

  if (loop && responses.length > 1) {
    connections.pop();
    connections.push(connect(nodes[nodes.length - 2].id, nodes[1].id));
  }

  return { startNodeId: "start", nodes, connections };
}

export function addResponseNode(graph: FlowGraph, responseId = ""): FlowGraph {
  const responseNodes = filter(graph.nodes, { type: "response" });
  const previous =
    responseNodes.at(-1) ??
    filter(graph.nodes, { type: "javascript" }).at(-1) ??
    find(graph.nodes, { type: "start" })!;
  const end = find(graph.nodes, { type: "end" })!;
  const existingEdge = find(
    graph.connections,
    (connection) =>
      connection.source === previous.id &&
      (previous.type !== "javascript" || connection.sourcePort === "next"),
  );
  const node: FlowNode = {
    id: makeId(),
    type: "response",
    responseId,
    x: previous.x + 250,
    y: previous.y,
  };
  const connections = filter(
    graph.connections,
    (connection) => connection.id !== existingEdge?.id,
  );
  connections.push(connect(previous.id, node.id));
  if (existingEdge) {
    connections.push(
      connect(node.id, existingEdge.target, existingEdge.sourcePort),
    );
  } else {
    connections.push(connect(node.id, end.id));
  }
  return { ...graph, nodes: [...graph.nodes, node], connections };
}

export function addJavaScriptNode(graph: FlowGraph): FlowGraph {
  const start = find(graph.nodes, { id: graph.startNodeId })!;
  const firstEdge = find(
    graph.connections,
    (connection) => connection.source === start.id,
  );
  const node: FlowNode = {
    id: makeId(),
    type: "javascript",
    x: start.x + 250,
    y: start.y,
    code: responseNodesExist(graph)
      ? 'return { output: "next", data: input.request };'
      : 'return { response: { status: 200, headers: { "content-type": "application/json" }, body: { ok: true }, delayMs: 0 } };',
    outputs: ["next", "success", "failure"],
  };
  const connections = filter(
    graph.connections,
    (connection) => connection.id !== firstEdge?.id,
  );
  connections.push(connect(start.id, node.id));
  if (firstEdge) {
    connections.push(connect(node.id, firstEdge.target, "next"));
  }
  return { ...graph, nodes: [...graph.nodes, node], connections };
}

function responseNodesExist(graph: FlowGraph): boolean {
  return graph.nodes.some((node) => node.type === "response");
}

export function isFlowLooped(graph: FlowGraph): boolean {
  const responses = filter(graph.nodes, { type: "response" });
  if (responses.length < 2) return false;
  return graph.connections.some(
    (connection) =>
      connection.source === responses.at(-1)!.id &&
      connection.target === responses[0].id,
  );
}

export function toggleFlowLoop(graph: FlowGraph): FlowGraph {
  const responses = filter(graph.nodes, { type: "response" });
  if (responses.length < 2) return graph;
  const first = responses[0];
  const last = responses.at(-1)!;
  const end = find(graph.nodes, { type: "end" });
  const connections = filter(
    graph.connections,
    (connection) => connection.source !== last.id,
  );
  connections.push(
    connect(last.id, isFlowLooped(graph) ? (end?.id ?? first.id) : first.id),
  );
  return { ...graph, connections };
}

export function removeFlowNode(graph: FlowGraph, nodeId: string): FlowGraph {
  if (nodeId === graph.startNodeId) return graph;
  const node = find(graph.nodes, { id: nodeId });
  if (!node || node.type === "end") return graph;

  const incoming = filter(graph.connections, { target: nodeId });
  const outgoing = filter(graph.connections, { source: nodeId });
  const connections = filter(
    graph.connections,
    (connection) =>
      connection.source !== nodeId && connection.target !== nodeId,
  );
  if (incoming.length === 1 && outgoing.length === 1) {
    connections.push(
      connect(incoming[0].source, outgoing[0].target, incoming[0].sourcePort),
    );
  }
  return {
    ...graph,
    nodes: filter(graph.nodes, (item) => item.id !== nodeId),
    connections,
  };
}

export function updateFlowNode(
  graph: FlowGraph,
  nodeId: string,
  updates: Partial<FlowNode>,
): FlowGraph {
  return {
    ...graph,
    nodes: map(graph.nodes, (node) =>
      node.id === nodeId ? { ...node, ...updates } : node,
    ),
  };
}

export function updateFlowNodePositions(
  graph: FlowGraph,
  positions: Map<string, { x: number; y: number }>,
): FlowGraph {
  return {
    ...graph,
    nodes: map(graph.nodes, (node) => ({
      ...node,
      ...(positions.has(node.id) ? positions.get(node.id) : {}),
    })),
  };
}

export function getFlowResponseIds(graph: FlowGraph): string[] {
  return graph.nodes
    .filter((node) => node.type === "response" && node.responseId)
    .map((node) => node.responseId!);
}

export function getResponsePath(graph: FlowGraph): string[] {
  const start = find(graph.nodes, { id: graph.startNodeId });
  if (!start) throw new Error("Flow needs a start node.");
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const path: string[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = start.id;
  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const node = nodes.get(currentId);
    if (!node) break;
    if (node.type === "response" && node.responseId) path.push(node.responseId);
    currentId = find(graph.connections, { source: currentId })?.target;
  }
  return path;
}

export function validateFlow(graph: FlowGraph): string | null {
  if (
    !graph.nodes.some(
      (node) => node.id === graph.startNodeId && node.type === "start",
    )
  ) {
    return "Add a start node to the flow.";
  }
  if (
    !graph.nodes.some(
      (node) => node.type === "response" || node.type === "javascript",
    )
  ) {
    return "Add a response or JavaScript node to the flow.";
  }
  for (const node of graph.nodes) {
    if (node.type === "response" && !node.responseId) {
      return "Choose a saved response for each response node.";
    }
    if (node.type === "javascript" && !node.code?.trim()) {
      return "Add JavaScript code to each JavaScript node.";
    }
  }
  if (
    !graph.connections.some(
      (connection) => connection.source === graph.startNodeId,
    )
  ) {
    return "Connect the start node to the rest of the flow.";
  }
  return null;
}
