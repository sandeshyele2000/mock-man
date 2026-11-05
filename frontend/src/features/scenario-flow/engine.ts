import groupBy from "lodash/groupBy";
import keyBy from "lodash/keyBy";

export type GraphNode = { id: string; type: string };

export type GraphConnection = {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
};

export type GraphStep = {
  nextPort?: string;
  done?: boolean;
};

export type GraphRun<N extends GraphNode, C> = {
  visited: N[];
  context: C;
};

/** Runs a graph from a start node using caller supplied node behavior. */
export function runGraph<N extends GraphNode, E extends GraphConnection, C>(
  nodes: N[],
  connections: E[],
  startNodeId: string,
  context: C,
  executeNode: (node: N, context: C) => GraphStep & { context?: C },
  maxSteps = 100,
): GraphRun<N, C> {
  const nodesById = keyBy(nodes, "id");
  const connectionsBySource = groupBy(connections, "source");
  const visited: N[] = [];
  let currentId: string | undefined = startNodeId;

  while (currentId) {
    if (visited.length >= maxSteps) {
      throw new Error(`Flow exceeded its ${maxSteps} step limit.`);
    }
    const node = nodesById[currentId] as N | undefined;
    if (!node)
      throw new Error(`Flow connection points to missing node ${currentId}.`);
    visited.push(node);

    const result = executeNode(node, context);
    if (result.context !== undefined) context = result.context;
    if (result.done) break;

    const outgoing: E[] = connectionsBySource[currentId] ?? [];
    const exactPort = result.nextPort
      ? outgoing.filter(
          (connection) => connection.sourcePort === result.nextPort,
        )
      : [];
    const eligible = exactPort.length
      ? exactPort
      : result.nextPort
        ? outgoing.filter((connection) => connection.sourcePort === undefined)
        : outgoing;
    if (eligible.length > 1) {
      throw new Error(`Node ${currentId} has multiple eligible connections.`);
    }
    currentId = eligible[0]?.target;
  }

  return { visited, context };
}
