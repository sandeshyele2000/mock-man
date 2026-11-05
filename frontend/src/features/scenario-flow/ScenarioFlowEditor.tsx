import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Code2,
  Download,
  GitBranch,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { Response, Scenario } from "../../api";
import { SelectField } from "../../components/ui/select";
import {
  addJavaScriptNode,
  addResponseNode,
  isFlowLooped,
  removeFlowNode,
  toggleFlowLoop,
  validateFlow,
  type FlowConnection,
  type FlowGraph,
  type FlowNode,
  type FlowNodeType,
} from "./model";

type FlowEditorNodeData = {
  node: FlowNode;
  responses: Response[];
  onUpdate: (nodeId: string, updates: Partial<FlowNode>) => void;
  onRemove: (nodeId: string) => void;
  onRemoveOutput: (nodeId: string, output: string) => void;
  onAddOutput: (nodeId: string) => void;
};
type FlowEditorNode = Node<FlowEditorNodeData, FlowNodeType>;
type FlowEditorEdge = Edge;

function StartNode() {
  return (
    <div className="xy-node xy-node-start">
      <span className="flow-node-dot" />
      <div>
        <strong>Incoming request</strong>
        <small>Start</small>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function ResponseNode({ id, data }: NodeProps<FlowEditorNode>) {
  const { node, responses, onUpdate, onRemove } = data;
  return (
    <div className="xy-node xy-node-response">
      <Handle type="target" position={Position.Left} />
      <div className="xy-node-heading">
        <GitBranch size={14} />
        <strong>Saved response</strong>
        <button
          className="flow-remove-button nodrag nopan"
          type="button"
          aria-label="Delete response node"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onRemove(id)}
        >
          <Trash2 size={13} />
        </button>
      </div>
      <SelectField
        aria-label="Select saved response"
        className="nodrag"
        value={node.responseId || ""}
        onValueChange={(responseId) => onUpdate(id, { responseId })}
        placeholder="Choose response"
        options={responses.map((response) => ({
          value: response.id,
          label: response.name + " · " + response.status,
        }))}
      />
      <small>
        {(responses.find((response) => response.id === node.responseId)
          ?.delayMs ?? 0) + " ms delay · returns one response per request"}
      </small>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function JavaScriptNode({ id, data }: NodeProps<FlowEditorNode>) {
  const { node, onUpdate, onRemove, onRemoveOutput, onAddOutput } = data;
  const updateNodeInternals = useUpdateNodeInternals();
  const outputs = node.outputs ?? ["next"];

  useEffect(
    () => updateNodeInternals(id),
    [id, outputs.length, updateNodeInternals],
  );

  return (
    <div className="xy-node xy-node-javascript">
      <Handle type="target" position={Position.Left} />
      <div className="xy-node-heading">
        <Code2 size={14} />
        <strong>JavaScript</strong>
        <button
          className="flow-remove-button nodrag nopan"
          type="button"
          aria-label="Delete JavaScript node"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onRemove(id)}
        >
          <Trash2 size={13} />
        </button>
      </div>
      <label className="xy-code-label" htmlFor={"code-" + id}>
        Code
      </label>
      <textarea
        id={"code-" + id}
        className="xy-code nodrag nowheel"
        spellCheck={false}
        value={node.code ?? ""}
        onChange={(event) => onUpdate(id, { code: event.target.value })}
        aria-label="JavaScript node code"
      />
      <div className="xy-output-list">
        <div className="xy-output-title">
          <span>Output paths</span>
          <button
            className="xy-add-output nodrag"
            type="button"
            onClick={() => onAddOutput(id)}
          >
            <Plus size={13} /> Add path
          </button>
        </div>
        {outputs.map((output, index) => (
          <div className="xy-output" key={output}>
            <Handle
              id={output}
              type="source"
              position={Position.Right}
              style={{ top: 174 + index * 26 }}
            />
            <code>{output}</code>
            <button
              className="xy-output-remove nodrag"
              type="button"
              aria-label={"Remove " + output + " output path"}
              disabled={outputs.length <= 1}
              onClick={() => onRemoveOutput(id, output)}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EndNode() {
  return (
    <div className="xy-node xy-node-end">
      <Handle type="target" position={Position.Left} />
      <span className="flow-node-dot" />
      <div>
        <strong>Repeat last response</strong>
        <small>When the flow ends</small>
      </div>
    </div>
  );
}

const nodeTypes = {
  start: StartNode,
  response: ResponseNode,
  javascript: JavaScriptNode,
  end: EndNode,
};

function toEditorNodes(
  graph: FlowGraph,
  responses: Response[],
  handlers: Pick<
    FlowEditorNodeData,
    "onUpdate" | "onRemove" | "onRemoveOutput" | "onAddOutput"
  >,
): FlowEditorNode[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: { x: node.x, y: node.y },
    data: { node, responses, ...handlers },
  })) as FlowEditorNode[];
}

function toEditorEdges(connections: FlowConnection[]): FlowEditorEdge[] {
  return connections.map((connection) => ({
    id: connection.id,
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourcePort || undefined,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#789b78" },
    type: "smoothstep",
  }));
}

function toFlowConnections(edges: FlowEditorEdge[]): FlowConnection[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle ? { sourcePort: edge.sourceHandle } : {}),
  }));
}

function FlowCanvas({
  graph,
  responses,
  onChange,
}: {
  graph: FlowGraph;
  responses: Response[];
  onChange: (graph: FlowGraph) => void;
}) {
  const graphRef = useRef(graph);
  const onChangeRef = useRef(onChange);
  graphRef.current = graph;
  onChangeRef.current = onChange;
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowEditorNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEditorEdge>([]);
  const { fitView } = useReactFlow<FlowEditorNode, FlowEditorEdge>();
  const graphShape =
    graph.nodes
      .map((node) => node.id + ":" + (node.outputs ?? []).join(","))
      .join("|") +
    ";" +
    graph.connections
      .map(
        (edge) =>
          edge.id +
          ":" +
          edge.source +
          ">" +
          edge.target +
          ":" +
          (edge.sourcePort ?? ""),
      )
      .join("|");

  const updateNode = useCallback(
    (nodeId: string, updates: Partial<FlowNode>) => {
      const nextGraph = {
        ...graphRef.current,
        nodes: graphRef.current.nodes.map((node) =>
          node.id === nodeId ? { ...node, ...updates } : node,
        ),
      };
      graphRef.current = nextGraph;
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  node: nextGraph.nodes.find((item) => item.id === nodeId)!,
                },
              }
            : node,
        ),
      );
      onChangeRef.current(nextGraph);
    },
    [setNodes],
  );

  const removeNode = useCallback(
    (nodeId: string) => {
      const nextGraph = removeFlowNode(graphRef.current, nodeId);
      graphRef.current = nextGraph;
      setNodes((current) => current.filter((node) => node.id !== nodeId));
      setEdges((current) =>
        current.filter(
          (edge) => edge.source !== nodeId && edge.target !== nodeId,
        ),
      );
      onChangeRef.current(nextGraph);
    },
    [setEdges, setNodes],
  );

  const removeOutput = useCallback(
    (nodeId: string, output: string) => {
      const nextGraph = graphRef.current;
      const nextNodes = nextGraph.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              outputs: (node.outputs ?? []).filter((item) => item !== output),
            }
          : node,
      );
      const connections = nextGraph.connections.filter(
        (connection) =>
          !(connection.source === nodeId && connection.sourcePort === output),
      );
      const updated = { ...nextGraph, nodes: nextNodes, connections };
      graphRef.current = updated;
      setEdges(toEditorEdges(connections));
      setNodes((current) =>
        current.map((item) =>
          item.id === nodeId
            ? {
                ...item,
                data: {
                  ...item.data,
                  node: nextNodes.find((node) => node.id === nodeId)!,
                },
              }
            : item,
        ),
      );
      onChangeRef.current(updated);
    },
    [setEdges, setNodes],
  );

  const addOutput = useCallback(
    (nodeId: string) => {
      const node = graphRef.current.nodes.find((item) => item.id === nodeId);
      if (!node) return;
      let index = (node.outputs?.length ?? 0) + 1;
      let name = "path" + index;
      while (node.outputs?.includes(name)) name = "path" + ++index;
      updateNode(nodeId, { outputs: [...(node.outputs ?? []), name] });
    },
    [updateNode],
  );

  useEffect(() => {
    const handlers = {
      onUpdate: updateNode,
      onRemove: removeNode,
      onRemoveOutput: removeOutput,
      onAddOutput: addOutput,
    };
    setNodes(toEditorNodes(graph, responses, handlers));
    setEdges(toEditorEdges(graph.connections));
    requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 180 }));
  }, [
    graph.startNodeId,
    graphShape,
    responses,
    fitView,
    setEdges,
    setNodes,
    updateNode,
    removeNode,
    removeOutput,
    addOutput,
  ]);

  const handleNodesChange: OnNodesChange<FlowEditorNode> = useCallback(
    (changes) => {
      onNodesChange(changes);
      const removed: string[] = [];
      const positions = new Map<string, { x: number; y: number }>();
      for (const change of changes) {
        if (change.type === "remove") removed.push(change.id);
        if (change.type === "position" && change.position) {
          positions.set(change.id, change.position);
        }
      }
      if (!removed.length && !positions.size) return;
      let nextGraph = graphRef.current;
      for (const nodeId of removed)
        nextGraph = removeFlowNode(nextGraph, nodeId);
      nextGraph = {
        ...nextGraph,
        nodes: nextGraph.nodes.map((node) => ({
          ...node,
          ...(positions.has(node.id) ? positions.get(node.id) : {}),
        })),
        connections: nextGraph.connections.filter(
          (connection) =>
            nextGraph.nodes.some((node) => node.id === connection.source) &&
            nextGraph.nodes.some((node) => node.id === connection.target),
        ),
      };
      graphRef.current = nextGraph;
      setEdges(toEditorEdges(nextGraph.connections));
      onChangeRef.current(nextGraph);
    },
    [onNodesChange, setEdges],
  );

  const handleEdgesChange: OnEdgesChange<FlowEditorEdge> = useCallback(
    (changes) => {
      onEdgesChange(changes);
      const removed = new Set(
        changes
          .filter((change) => change.type === "remove")
          .map((change) => change.id),
      );
      if (!removed.size) return;
      const nextGraph = {
        ...graphRef.current,
        connections: graphRef.current.connections.filter(
          (edge) => !removed.has(edge.id),
        ),
      };
      graphRef.current = nextGraph;
      onChangeRef.current(nextGraph);
    },
    [onEdgesChange],
  );

  const isValidConnection = useCallback(
    (connection: FlowEditorEdge | Connection) => {
      if (
        !connection.source ||
        !connection.target ||
        connection.source === connection.target
      )
        return false;
      const graphNow = graphRef.current;
      const source = graphNow.nodes.find(
        (node) => node.id === connection.source,
      );
      const target = graphNow.nodes.find(
        (node) => node.id === connection.target,
      );
      if (
        !source ||
        !target ||
        target.type === "start" ||
        source.type === "end"
      )
        return false;
      const outgoing = graphNow.connections.filter(
        (edge) => edge.source === source.id,
      );
      if (source.type === "javascript") {
        return !outgoing.some(
          (edge) => edge.sourcePort === (connection.sourceHandle || ""),
        );
      }
      return outgoing.length === 0;
    },
    [],
  );

  const handleConnect: OnConnect = useCallback(
    (connection) => {
      if (!isValidConnection(connection)) return;
      const nextEdges = addEdge(
        {
          ...connection,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed, color: "#789b78" },
        },
        edges,
      );
      setEdges(nextEdges);
      const nextGraph = {
        ...graphRef.current,
        connections: toFlowConnections(nextEdges),
      };
      graphRef.current = nextGraph;
      onChangeRef.current(nextGraph);
    },
    [edges, isValidConnection, setEdges],
  );

  return (
    <div className="flow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        isValidConnection={isValidConnection}
        deleteKeyCode={["Backspace", "Delete"]}
        fitView
        defaultEdgeOptions={{
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function ScenarioFlowEditor({
  graph,
  responses,
  onChange,
  metadata,
  onImport,
}: {
  graph: FlowGraph;
  responses: Response[];
  onChange: (graph: FlowGraph) => void;
  metadata: Pick<
    Scenario,
    "name" | "behavior" | "count" | "priority" | "conditions"
  >;
  onImport: (
    responses: Response[],
    graph: FlowGraph,
    metadata: Pick<
      Scenario,
      "name" | "behavior" | "count" | "priority" | "conditions"
    >,
  ) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState("");
  const looped = isFlowLooped(graph);

  function exportFlow() {
    const responseIds = new Set(
      graph.nodes.flatMap((node) => (node.responseId ? [node.responseId] : [])),
    );
    const bundle = {
      format: "mockman-scenario-flow",
      version: 1,
      flow: graph,
      scenario: metadata,
      responses: responses.filter((response) => responseIds.has(response.id)),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "mockman-scenario-flow.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importFlow(file?: File) {
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      if (
        bundle?.format !== "mockman-scenario-flow" ||
        bundle?.version !== 1 ||
        !Array.isArray(bundle.responses) ||
        !bundle.scenario ||
        typeof bundle.scenario.name !== "string" ||
        !["always", "flow", "failFirst", "failAfter", "sequence"].includes(
          bundle.scenario.behavior,
        ) ||
        !Number.isInteger(bundle.scenario.count) ||
        !Number.isInteger(bundle.scenario.priority) ||
        !Array.isArray(bundle.scenario.conditions) ||
        !bundle.flow ||
        !Array.isArray(bundle.flow.nodes) ||
        !Array.isArray(bundle.flow.connections)
      ) {
        throw new Error("This file is not a supported Mockman flow export.");
      }
      const ids = new Map<string, string>();
      const imported = (bundle.responses as Response[]).map((response) => {
        if (
          !response?.id ||
          ids.has(response.id) ||
          !response.name ||
          !response.headers
        ) {
          throw new Error("The export contains an invalid saved response.");
        }
        const newID = crypto.randomUUID().slice(0, 8);
        ids.set(response.id, newID);
        return { ...response, id: newID };
      });
      const nextFlow = structuredClone(bundle.flow) as FlowGraph;
      for (const node of nextFlow.nodes) {
        if (node.type !== "response") continue;
        const mapped = node.responseId && ids.get(node.responseId);
        if (!mapped)
          throw new Error(
            "A referenced saved response is missing from the export.",
          );
        node.responseId = mapped;
      }
      const issue = validateFlow(nextFlow);
      if (issue) throw new Error(issue);
      onImport(imported, nextFlow, bundle.scenario);
      setImportError("");
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Could not import this flow.",
      );
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <section className="scenario-flow" aria-label="Scenario flow editor">
      <div className="flow-toolbar">
        <div>
          <strong>Scenario flow</strong>
          <p>
            Connect saved responses and JavaScript nodes to define request
            behavior.
          </p>
        </div>
        <div className="flow-actions">
          <button type="button" onClick={exportFlow}>
            <Download size={14} /> Export
          </button>
          <button type="button" onClick={() => fileInput.current?.click()}>
            <Upload size={14} /> Import
          </button>
          <input
            ref={fileInput}
            hidden
            type="file"
            accept="application/json,.json"
            aria-label="Import scenario flow JSON"
            onChange={(event) => void importFlow(event.target.files?.[0])}
          />
          <button
            className={looped ? "is-active" : ""}
            type="button"
            aria-pressed={looped}
            disabled={responses.length < 2}
            onClick={() => onChange(toggleFlowLoop(graph))}
          >
            <RotateCcw size={14} /> {looped ? "Loop enabled" : "Loop responses"}
          </button>
          <button
            className="flow-add-button"
            type="button"
            disabled={!responses.length}
            onClick={() => onChange(addResponseNode(graph, responses[0]?.id))}
          >
            <Plus size={14} /> Add response
          </button>
          <button
            className="flow-add-button flow-add-code"
            type="button"
            onClick={() => onChange(addJavaScriptNode(graph))}
          >
            <Code2 size={14} /> Add JavaScript
          </button>
        </div>
      </div>
      {importError && (
        <p className="error" role="alert">
          {importError}
        </p>
      )}
      {!responses.length && (
        <div className="flow-empty">
          No saved responses yet. JavaScript nodes can return a custom HTTP
          response.
        </div>
      )}
      <div className="flow-viewport">
        <ReactFlowProvider>
          <FlowCanvas graph={graph} responses={responses} onChange={onChange} />
        </ReactFlowProvider>
      </div>
      <div className="flow-contract">
        <strong>JavaScript input</strong>
        <code>
          input.request, input.attempt, input.session, input.environment,
          input.data
        </code>
        <span>
          Return <code>{'{ output: "path", data: value }'}</code>,{" "}
          <code>{'{ responseId: "saved-id" }'}</code>, or{" "}
          <code>{"{ response: { status, headers, body, delayMs } }"}</code>.
        </span>
      </div>
    </section>
  );
}
