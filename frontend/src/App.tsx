import { ADMIN_HOST, MOCK_HOST, MOCK_PORT, MOCK_SERVER_URL } from "./config";
import {
  Modal,
  EntityForm,
  ResponseForm,
  ScenarioForm,
  TryForm,
  behaviors,
} from "./components/editors";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Copy,
  Download,
  Folder,
  Layers,
  Moon,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Server,
  Settings2,
  Sun,
  Trash2,
  Upload,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Zap,
} from "lucide-react";
import {
  api,
  loadConfig,
  type Config,
  type Project,
  type Feature,
  type Endpoint,
  type Response,
  type Scenario,
  type Log,
} from "./api";
import { Button } from "./components/ui/button";
import { SelectField } from "./components/ui/select";
import { MockmanMark } from "./components/brand";
const pretty = (v: unknown) => JSON.stringify(v, null, 2);
type ModalState =
  | { kind: "project"; value?: Project }
  | { kind: "feature"; value?: Feature }
  | { kind: "endpoint"; value?: Endpoint }
  | { kind: "response"; value?: Response }
  | { kind: "scenario"; value?: Scenario }
  | { kind: "try" };
export default function App() {
  const client = useQueryClient();
  const config = useQuery({ queryKey: ["config"], queryFn: loadConfig });
  const [projectID, setProjectID] = useState("demo");
  const [featureID, setFeatureID] = useState("");
  const [expandedFeatureID, setExpandedFeatureID] = useState("");
  const [endpointID, setEndpointID] = useState("");
  const [environment, setEnvironment] = useState("development");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem("mockman-theme") === "dark" ? "dark" : "light",
  );
  const [tab, setTab] = useState("responses");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalState | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const scenarioImportRef = useRef<HTMLInputElement>(null);
  const featureImportRef = useRef<HTMLInputElement>(null);
  const c = config.data;
  const p = c?.projects.find((p) => p.id === projectID) || c?.projects[0];
  const f = p?.features.find((f) => f.id === featureID) || p?.features[0];
  const e = f?.endpoints.find((e) => e.id === endpointID) || f?.endpoints[0];
  const env = p?.environments.includes(environment)
    ? environment
    : p?.environments[0] || "development";
  const logs = useQuery({
    queryKey: ["logs", p?.id, env],
    queryFn: () =>
      api<Log[]>(
        `/api/logs?project=${encodeURIComponent(p!.id)}&environment=${encodeURIComponent(env)}`,
      ),
    enabled: !!p,
    refetchInterval: 2000,
  });
  const save = useMutation({
    mutationFn: (next: Config) => api<Config>("/api/config", "PUT", next),
    onSuccess: (data) => {
      client.setQueryData(["config"], data);
      setModal(null);
      setError("");
      setNotice("Workspace saved");
    },
    onError: (err) => setError(err.message),
  });
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 3500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  useEffect(() => {
    localStorage.setItem("mockman-theme", theme);
  }, [theme]);
  function change(
    update: (
      next: Config,
      project: Project,
      feature: Feature | undefined,
      endpoint: Endpoint | undefined,
    ) => void,
  ) {
    if (!c || !p) return;
    const next = structuredClone(c);
    const np = next.projects.find((v) => v.id === p.id)!;
    const nf = np.features.find((v) => v.id === f?.id);
    const ne = nf?.endpoints.find((v) => v.id === e?.id);
    update(next, np, nf, ne);
    save.mutate(next);
  }
  function remove(
    kind: string,
    name: string,
    update: Parameters<typeof change>[0],
  ) {
    if (
      window.confirm(
        `Delete ${kind} “${name}”? This also removes its nested configuration.`,
      )
    )
      change(update);
  }
  function saveEntity(value: Project | Feature | Endpoint) {
    if (modal?.kind === "project") {
      if (!c) return;
      const next = structuredClone(c);
      const idx = next.projects.findIndex((v) => v.id === value.id);
      if (idx < 0) next.projects.push(value as Project);
      else next.projects[idx] = value as Project;
      save.mutate(next);
      setProjectID(value.id);
    } else if (modal?.kind === "feature")
      change((_, p) => {
        const idx = p.features.findIndex((v) => v.id === value.id);
        if (idx < 0) p.features.push(value as Feature);
        else p.features[idx] = value as Feature;
        setFeatureID(value.id);
        setExpandedFeatureID(value.id);
      });
    else
      change((_, __, f) => {
        if (!f) return;
        const idx = f.endpoints.findIndex((v) => v.id === value.id);
        if (idx < 0) f.endpoints.push(value as Endpoint);
        else f.endpoints[idx] = value as Endpoint;
        setEndpointID(value.id);
      });
  }
  function saveResponse(v: Response) {
    change((_, __, ___, e) => {
      if (!e) return;
      const i = e.responses.findIndex((r) => r.id === v.id);
      if (i < 0) e.responses.push(v);
      else e.responses[i] = v;
    });
  }
  function saveScenario(v: Scenario, importedResponses: Response[] = []) {
    change((_, __, ___, e) => {
      if (!e) return;
      const importedIDs = new Set(
        importedResponses.map((response) => response.id),
      );
      e.responses = [
        ...e.responses.filter((response) => !importedIDs.has(response.id)),
        ...importedResponses,
      ];
      const i = e.scenarios.findIndex((s) => s.id === v.id);
      if (i < 0) e.scenarios.push(v);
      else e.scenarios[i] = v;
      if (!e.active[env]) e.active[env] = v.id;
    });
  }
  function exportScenario(scenario: Scenario) {
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
      responses: (e?.responses ?? []).filter(
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
  function exportFeature(feature: Feature) {
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
  async function importFeature(file?: File) {
    if (!file || !p) return;
    try {
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
          throw new Error(
            `The export contains missing or duplicate ${label} IDs.`,
          );
        }
        return new Map(
          values.map((value) => [value, crypto.randomUUID().slice(0, 8)]),
        );
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
        id: crypto.randomUUID().slice(0, 8),
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
                scenario.flow?.connections.map((connection) => connection.id) ??
                  [],
                "flow connection",
              );
              return {
                ...scenario,
                id: requireMappedID(scenarioIDs, scenario.id, "scenario"),
                revision: "",
                responseIds: scenario.responseIds.map((id) =>
                  requireMappedID(responseIDs, id, "response"),
                ),
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
                .filter(([environment]) => p.environments.includes(environment))
                .map(([environment, scenarioID]) => [
                  environment,
                  requireMappedID(scenarioIDs, scenarioID, "scenario"),
                ]),
            ),
          };
        }),
      };
      change((_, project) => {
        project.features.push(importedFeature);
      });
      setFeatureID(importedFeature.id);
      setExpandedFeatureID(importedFeature.id);
      setEndpointID("");
      setNotice(`Imported feature “${importedFeature.name}”.`);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not import this feature.",
      );
    } finally {
      if (featureImportRef.current) featureImportRef.current.value = "";
    }
  }
  async function importScenario(file?: File) {
    if (!file || !e) return;
    try {
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
        throw new Error(
          "This file is not a supported Mockman scenario export.",
        );
      }
      const ids = new Map<string, string>();
      const importedResponses = responses.map((response) => {
        if (
          !response?.id ||
          ids.has(response.id) ||
          !response.name ||
          !response.headers
        ) {
          throw new Error(
            "The export contains an invalid or duplicate response.",
          );
        }
        const importedID = crypto.randomUUID().slice(0, 8);
        ids.set(response.id, importedID);
        return { ...response, id: importedID };
      });
      const importedScenario: Scenario = {
        ...scenario,
        id: crypto.randomUUID().slice(0, 8),
        revision: "",
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
      change((_, __, ___, endpoint) => {
        if (!endpoint) return;
        endpoint.responses.push(...importedResponses);
        endpoint.scenarios.push(importedScenario);
        if (!endpoint.active[env]) endpoint.active[env] = importedScenario.id;
      });
      setNotice(`Imported scenario “${importedScenario.name}”.`);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not import this scenario.",
      );
    } finally {
      if (scenarioImportRef.current) scenarioImportRef.current.value = "";
    }
  }
  const active = e?.scenarios.find((s) => s.id === e.active[env]);
  function nextResponseIndex(scenario: Scenario) {
    const latest = logs.data?.find(
      (log) =>
        log.detail.endpoint === e?.id &&
        log.detail.scenario === scenario.id &&
        log.detail.revision === scenario.revision &&
        log.detail.session === "default",
    );
    const attempt = latest?.detail.attempt ?? 1;
    if (scenario.behavior === "failFirst")
      return attempt > scenario.count ? 1 : 0;
    if (scenario.behavior === "failAfter")
      return attempt <= scenario.count ? 1 : 0;
    if (scenario.behavior === "sequence") {
      return scenario.exhaustion === "repeat"
        ? Math.min(attempt - 1, scenario.responseIds.length - 1)
        : (attempt - 1) % scenario.responseIds.length;
    }
    return 0;
  }
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const curl =
    e && p
      ? [
          `curl -i -X ${e.method} ${quote(`${MOCK_SERVER_URL.replace(/\/$/, "")}${encodeURI(e.path)}`)}`,
          `  -H ${quote(`X-Mock-Project: ${p.id}`)}`,
          `  -H ${quote(`X-Mock-Environment: ${env}`)}`,
        ].join(" \\\n")
      : "";
  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(curl);
      setNotice("curl copied");
    } catch {
      setError("Clipboard unavailable. Select and copy the curl text below.");
    }
  }
  if (config.isPending)
    return (
      <div className="boot">
        <MockmanMark size={32} />
        <h2>Opening your workspace…</h2>
      </div>
    );
  if (config.isError)
    return (
      <div className="boot">
        <h2>Could not load Mockman</h2>
        <p>{config.error.message}</p>
        <Button onClick={() => void config.refetch()}>Try again</Button>
      </div>
    );
  return (
    <div className="app" data-theme={theme}>
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <a className="brand" href="/">
          <span className="brand-icon">
            <MockmanMark size={23} />
          </span>
        </a>
        <Button
          className="sidebar-toggle"
          variant="ghost"
          size="icon"
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={16} />
          ) : (
            <PanelLeftClose size={16} />
          )}
        </Button>
        {!sidebarCollapsed && (
          <>
            <div className="workspace-label">WORKSPACE</div>
            <div className="project-select">
              <Layers size={17} />
              <SelectField
                aria-label="Project"
                value={p?.id || ""}
                onValueChange={(value) => {
                  setProjectID(value);
                  setFeatureID("");
                  setExpandedFeatureID("");
                  setEndpointID("");
                }}
                options={
                  c?.projects.map((v) => ({ value: v.id, label: v.name })) || []
                }
                placeholder="No projects yet"
              />
            </div>
            <div className="project-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setModal({ kind: "project" })}
              >
                <Plus size={13} />
                Project
              </Button>
              {p && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit project"
                    onClick={() => setModal({ kind: "project", value: p })}
                  >
                    <Settings2 size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete project"
                    onClick={() =>
                      remove("project", p.name, (next) => {
                        next.projects = next.projects.filter(
                          (v) => v.id !== p.id,
                        );
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </Button>
                </>
              )}
            </div>
            <div className="side-rule" />
            <div className="side-heading">
              FEATURES
              <Button
                disabled={!p}
                variant="ghost"
                size="icon"
                aria-label="Add feature"
                onClick={() => setModal({ kind: "feature" })}
              >
                <Plus size={15} />
              </Button>
            </div>
            <nav>
              {p?.features.map((feature) => (
                <div key={feature.id}>
                  <button
                    className={`feature-nav ${f?.id === feature.id ? "selected" : ""}`}
                    aria-expanded={expandedFeatureID === feature.id}
                    onClick={() => {
                      setFeatureID(feature.id);
                      setExpandedFeatureID(
                        expandedFeatureID === feature.id ? "" : feature.id,
                      );
                      setEndpointID("");
                    }}
                  >
                    <Folder size={16} />
                    <span>{feature.name}</span>
                    <span className="count">{feature.endpoints.length}</span>
                    {expandedFeatureID === feature.id ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </button>
                  <AnimatePresence initial={false}>
                    {expandedFeatureID === feature.id && (
                      <motion.div
                        className="feature-endpoints"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                      >
                        {feature.endpoints.map((endpoint) => (
                          <button
                            key={endpoint.id}
                            className={`endpoint-nav ${e?.id === endpoint.id ? "current" : ""}`}
                            onClick={() => setEndpointID(endpoint.id)}
                          >
                            <span
                              className={`method-small ${endpoint.method.toLowerCase()}`}
                            >
                              {endpoint.method}
                            </span>
                            <span>{endpoint.name}</span>
                            {!endpoint.enabled && <Circle size={8} />}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="server-state">
                <span className="live-dot" />
                <span>Local workspace</span>
                <span className="port">:{MOCK_PORT}</span>
              </div>
              <div className="version">
                <span>Mockman</span>
                <span>v0.1</span>
              </div>
            </div>
          </>
        )}
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Button
            className="mobile-sidebar-toggle"
            variant="ghost"
            size="icon"
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={16} />
            ) : (
              <PanelLeftClose size={16} />
            )}
          </Button>
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <span>{p?.name || "Get started"}</span>
            <ChevronRight size={13} />
            <b>{f?.name || "Features"}</b>
          </div>
          <div className="top-context">
            <span className="live-dot" />
            <SelectField
              aria-label="Environment"
              value={env}
              onValueChange={setEnvironment}
              options={
                p?.environments.map((v) => ({ value: v, label: v })) || []
              }
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </Button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="tiny-square" />
                API WORKSPACE
              </div>
              <h1>
                {f?.name || "Your next API starts here"}
                <span className="heading-dot">.</span>
              </h1>
            </div>
            <div className="heading-actions">
              <input
                ref={featureImportRef}
                hidden
                type="file"
                accept="application/json,.json"
                aria-label="Import feature JSON"
                onChange={(event) =>
                  void importFeature(event.target.files?.[0])
                }
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Export feature"
                disabled={!f}
                onClick={() => f && exportFeature(f)}
              >
                <Download size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Import feature"
                disabled={!p}
                onClick={() => featureImportRef.current?.click()}
              >
                <Upload size={15} />
              </Button>
              {f && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit feature"
                    onClick={() => setModal({ kind: "feature", value: f })}
                  >
                    <Pencil size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete feature"
                    onClick={() =>
                      remove("feature", f.name, (_, p) => {
                        p.features = p.features.filter((v) => v.id !== f.id);
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </Button>
                </>
              )}
              <Button
                disabled={!f}
                onClick={() => setModal({ kind: "endpoint" })}
              >
                <Plus size={16} />
                New endpoint
              </Button>
            </div>
          </div>
          {error && (
            <div role="alert" className="error banner">
              {error}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setError("");
                  void config.refetch();
                }}
              >
                Reload workspace
              </Button>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          <div className="overview">
            <div>
              <span className="stat-icon">
                <ArrowDownUp size={17} />
              </span>
              <span>
                <small>Endpoints</small>
                <b>{f?.endpoints.length || 0}</b>
              </span>
            </div>
            <div>
              <span className="stat-icon">
                <Zap size={17} />
              </span>
              <span>
                <small>Mocking enabled</small>
                <b>
                  {f?.endpoints.filter((v) => v.enabled).length || 0}
                  <em> ready to intercept</em>
                </b>
              </span>
            </div>
            <div>
              <span className="stat-icon">
                <Activity size={17} />
              </span>
              <span>
                <small>Recent requests</small>
                <b>
                  {logs.data?.length || 0}
                  <em> in {env}</em>
                </b>
              </span>
            </div>
          </div>
          <motion.div
            key={e?.id || "empty-workspace"}
            className="content-grid"
            initial={{ opacity: 0, y: 7 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <section className="endpoint-list panel">
              <div className="panel-heading">
                <h2>
                  Endpoints <span>{f?.endpoints.length || 0}</span>
                </h2>
                <MoreHorizontal size={18} />
              </div>
              <div className="search">
                <Search size={15} />
                <input
                  aria-label="Search endpoints"
                  placeholder="Search endpoints…"
                  value={search}
                  onChange={(ev) => setSearch(ev.target.value)}
                />
                <kbd>⌕</kbd>
              </div>
              <div className="endpoint-items">
                {f?.endpoints
                  .filter((v) =>
                    (v.name + v.path + v.method)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((v) => (
                    <button
                      key={v.id}
                      className={`endpoint-item ${e?.id === v.id ? "active" : ""}`}
                      onClick={() => setEndpointID(v.id)}
                    >
                      <div>
                        <span className={`method ${v.method.toLowerCase()}`}>
                          {v.method}
                        </span>
                        <span
                          className={v.enabled ? "enabled-dot" : "disabled-dot"}
                        />
                      </div>
                      <b>{v.name}</b>
                      <code>{v.path}</code>
                      <small>
                        {v.scenarios.length} scenario
                        {v.scenarios.length !== 1 ? "s" : ""}
                        <ChevronRight size={13} />
                      </small>
                    </button>
                  ))}
                {!f?.endpoints.length && (
                  <div className="empty compact">
                    <Code2 />
                    <h3>No endpoints yet</h3>
                    <p>Add your first method and API path.</p>
                  </div>
                )}
              </div>
            </section>
            <section className="endpoint-detail panel">
              {e ? (
                <>
                  <div className="detail-heading">
                    <div className="route">
                      <span className={`method ${e.method.toLowerCase()}`}>
                        {e.method}
                      </span>
                      <code>{e.path}</code>
                    </div>
                    <div className="detail-tools">
                      <label className="toggle">
                        <input
                          type="checkbox"
                          aria-label="Mocking enabled"
                          checked={e.enabled}
                          disabled={save.isPending}
                          onChange={(ev) =>
                            change((_, __, ___, e) => {
                              e!.enabled = ev.target.checked;
                            })
                          }
                        />
                        <span />
                        {e.enabled ? "Mocking on" : "Mocking off"}
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit endpoint"
                        onClick={() => setModal({ kind: "endpoint", value: e })}
                      >
                        <Pencil size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete endpoint"
                        onClick={() =>
                          remove("endpoint", e.name, (_, __, f) => {
                            f!.endpoints = f!.endpoints.filter(
                              (v) => v.id !== e.id,
                            );
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </div>
                  <div className="detail-subheading">
                    <h2>{e.name}</h2>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setModal({ kind: "try" })}
                    >
                      <Play size={13} />
                      Try request
                    </Button>
                  </div>
                  <div className="tabs" role="tablist">
                    {[
                      ["responses", "Responses", e.responses.length],
                      ["scenarios", "Scenarios", e.scenarios.length],
                      [
                        "logs",
                        "Request logs",
                        logs.data?.filter((v) => v.detail.endpoint === e.id)
                          .length || 0,
                      ],
                      ["connect", "Connect", null],
                    ].map(([v, label, n]) => (
                      <button
                        key={v}
                        role="tab"
                        aria-selected={tab === v}
                        className={tab === v ? "selected" : ""}
                        onClick={() => setTab(String(v))}
                      >
                        {label}
                        {n !== null && <span>{n}</span>}
                      </button>
                    ))}
                  </div>
                  <div className="tab-content">
                    {tab === "responses" && (
                      <>
                        <div className="section-heading">
                          <div>
                            <h3>Named responses</h3>
                            <p>The building blocks for every scenario.</p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setModal({ kind: "response" })}
                          >
                            <Plus size={14} />
                            Add response
                          </Button>
                        </div>
                        {e.responses.map((r) => (
                          <article className="response-card" key={r.id}>
                            <div className="card-heading">
                              <div>
                                <span
                                  className={`status ${r.status >= 400 ? "failure" : "success"}`}
                                >
                                  {r.status}
                                </span>
                                <b>{r.name}</b>
                              </div>
                              <div>
                                <span className="delay">
                                  {r.delayMs.toLocaleString()} ms
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Edit response ${r.name}`}
                                  onClick={() =>
                                    setModal({ kind: "response", value: r })
                                  }
                                >
                                  <Pencil size={13} />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Delete response ${r.name}`}
                                  onClick={() =>
                                    remove(
                                      "response",
                                      r.name,
                                      (_, __, ___, e) => {
                                        e!.responses = e!.responses.filter(
                                          (v) => v.id !== r.id,
                                        );
                                      },
                                    )
                                  }
                                >
                                  <Trash2 size={13} />
                                </Button>
                              </div>
                            </div>
                            <pre>{pretty(r.body)}</pre>
                            <div className="card-footer">
                              <span>
                                <Code2 size={12} /> JSON
                              </span>
                              <span>
                                {Object.keys(r.headers).length} header
                                {Object.keys(r.headers).length !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </article>
                        ))}
                        {!e.responses.length && (
                          <div className="empty">
                            <Code2 />
                            <h3>Give this endpoint a response</h3>
                            <p>
                              Define a status, JSON body and optional delay.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                    {tab === "scenarios" && (
                      <>
                        <div className="section-heading">
                          <div>
                            <h3>Response behavior</h3>
                            <p>Choose what happens on each attempt.</p>
                          </div>
                          <div className="scenario-import-actions">
                            <input
                              ref={scenarioImportRef}
                              hidden
                              type="file"
                              accept="application/json,.json"
                              aria-label="Import scenario JSON"
                              onChange={(event) =>
                                void importScenario(event.target.files?.[0])
                              }
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => scenarioImportRef.current?.click()}
                            >
                              <Upload size={14} />
                              Import
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!e.responses.length}
                              onClick={() => setModal({ kind: "scenario" })}
                            >
                              <Plus size={14} />
                              Add scenario
                            </Button>
                          </div>
                        </div>
                        {e.scenarios.map((s) => (
                          <article
                            className={`scenario-card ${s.id === active?.id ? "is-active" : ""}`}
                            key={s.id}
                          >
                            <div className="card-heading">
                              <div>
                                <span className="scenario-icon">
                                  <Zap size={16} />
                                </span>
                                <b>{s.name}</b>
                                {s.id === active?.id && (
                                  <span className="active-badge">ACTIVE</span>
                                )}
                              </div>
                              <div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Export scenario ${s.name}`}
                                  onClick={() => exportScenario(s)}
                                >
                                  <Download size={14} />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Edit scenario ${s.name}`}
                                  disabled={
                                    !Object.hasOwn(behaviors, s.behavior)
                                  }
                                  onClick={() =>
                                    setModal({ kind: "scenario", value: s })
                                  }
                                >
                                  <Pencil size={14} />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Delete scenario ${s.name}`}
                                  onClick={() =>
                                    remove(
                                      "scenario",
                                      s.name,
                                      (_, __, ___, e) => {
                                        e!.scenarios = e!.scenarios.filter(
                                          (v) => v.id !== s.id,
                                        );
                                        for (const env of Object.keys(
                                          e!.active,
                                        )) {
                                          if (e!.active[env] === s.id)
                                            delete e!.active[env];
                                        }
                                      },
                                    )
                                  }
                                >
                                  <Trash2 size={14} />
                                </Button>
                              </div>
                            </div>
                            <p>
                              {behaviors[
                                s.behavior as keyof typeof behaviors
                              ] ?? "Visual flow (view only)"}
                              {["failFirst", "failAfter"].includes(
                                s.behavior,
                              ) && <b> · N = {s.count}</b>}
                              {s.behavior === "sequence" &&
                                ` · ${s.exhaustion === "loop" ? "Loop" : "Repeat final"}`}
                            </p>
                            <div className="response-flow">
                              {s.responseIds.map((rid, i) => {
                                const isNext =
                                  s.id === active?.id &&
                                  s.behavior !== "flow" &&
                                  i === nextResponseIndex(s);
                                return (
                                  <span
                                    className={isNext ? "is-next" : undefined}
                                    key={i}
                                  >
                                    {i > 0 && <ArrowRight size={13} />}
                                    <code>
                                      {
                                        e.responses.find((r) => r.id === rid)
                                          ?.name
                                      }
                                    </code>
                                    {isNext && (
                                      <small className="step-state">NEXT</small>
                                    )}
                                  </span>
                                );
                              })}
                            </div>
                            {s.conditions.length > 0 && (
                              <p className="conditions-preview">
                                {s.conditions
                                  .map(
                                    (c) => `${c.source}.${c.key} = ${c.value}`,
                                  )
                                  .join(" AND ")}{" "}
                                · priority {s.priority}
                              </p>
                            )}
                            <div className="scenario-footer">
                              <small>Revision {s.revision.slice(0, 8)}</small>
                              <Button
                                variant={
                                  s.id === active?.id ? "ghost" : "outline"
                                }
                                size="sm"
                                disabled={save.isPending || s.id === active?.id}
                                onClick={() =>
                                  change((_, __, ___, e) => {
                                    e!.active[env] = s.id;
                                  })
                                }
                              >
                                {s.id === active?.id ? (
                                  <>
                                    <Check size={13} />
                                    Active in {env}
                                  </>
                                ) : (
                                  "Activate scenario"
                                )}
                              </Button>
                            </div>
                          </article>
                        ))}
                        {!e.scenarios.length && (
                          <div className="empty">
                            <Zap />
                            <h3>No scenario selected</h3>
                            <p>
                              {e.responses.length
                                ? "Add a scenario to start serving requests."
                                : "Add a response first, then define its behavior."}
                            </p>
                          </div>
                        )}
                      </>
                    )}
                    {tab === "logs" && (
                      <>
                        <div className="section-heading">
                          <div>
                            <h3>Request activity</h3>
                            <p>Matched requests · refreshes every 2 seconds</p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void logs.refetch()}
                          >
                            <RotateCcw size={13} />
                            Refresh
                          </Button>
                        </div>
                        {logs.isError && (
                          <p className="error" role="alert">
                            Could not load logs: {logs.error.message}
                          </p>
                        )}
                        <div className="log-list">
                          {logs.data
                            ?.filter((v) => v.detail.endpoint === e.id)
                            .map((l) => (
                              <details key={l.id} className="log-row">
                                <summary>
                                  <span
                                    className={`status ${l.detail.status >= 400 ? "failure" : "success"}`}
                                  >
                                    {l.detail.status}
                                  </span>
                                  <b>Attempt {l.detail.attempt}</b>
                                  <span>{l.detail.delayMs} ms</span>
                                  <time>
                                    {new Date(l.createdAt).toLocaleTimeString()}
                                  </time>
                                  <ChevronDown size={13} />
                                </summary>
                                <dl>
                                  <dt>Scenario</dt>
                                  <dd>{l.detail.scenario}</dd>
                                  <dt>Revision</dt>
                                  <dd>{l.detail.revision}</dd>
                                  <dt>Matched rule</dt>
                                  <dd>{l.detail.reason}</dd>
                                </dl>
                              </details>
                            ))}
                        </div>
                        {!logs.isPending &&
                          !logs.data?.some(
                            (v) => v.detail.endpoint === e.id,
                          ) && (
                            <div className="empty">
                              <Activity />
                              <h3>Waiting for your first request</h3>
                              <p>
                                Use Try request or call the mock listener from
                                your app.
                              </p>
                            </div>
                          )}
                        <p className="footnote">
                          Logs record the allocated response before delay.
                          Disconnected requests still consume their attempt.
                        </p>
                      </>
                    )}
                    {tab === "connect" && (
                      <>
                        <div className="section-heading">
                          <div>
                            <h3>Connect your application</h3>
                            <p>Keep your original path. Change the origin.</p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void copyCurl()}
                          >
                            <Copy size={13} />
                            Copy curl
                          </Button>
                        </div>
                        <pre className="curl">{curl}</pre>
                        <div className="info-box">
                          <Server size={18} />
                          <div>
                            <b>Two listeners, one workspace</b>
                            <p>
                              Admin API: {ADMIN_HOST}
                              <br />
                              Mock API: {MOCK_HOST}
                            </p>
                            <p>
                              Set MOCK_ADDR=0.0.0.0:{MOCK_PORT} for a physical
                              device. Use your computer’s LAN address. Keep real
                              credentials out of mock requests.
                            </p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="detail-bottom">
                    <span className="live-dot" />
                    <span>
                      {active ? active.name : "No active scenario"}
                      <small> in {env}</small>
                    </span>
                    <span className="saved">
                      <Check size={12} />
                      Saved configuration
                    </span>
                  </div>
                </>
              ) : (
                <div className="empty large">
                  <MockmanMark size={36} />
                  <h3>
                    {p ? "Build your first mock API" : "Welcome to Mockman"}
                  </h3>
                  <p>
                    {f
                      ? "Create an endpoint to configure responses and scenarios."
                      : p
                        ? "Create a feature to group related endpoints."
                        : "Create a project to organize your API workspace."}
                  </p>
                  <Button
                    onClick={() =>
                      setModal({
                        kind: !p ? "project" : !f ? "feature" : "endpoint",
                      })
                    }
                  >
                    <Plus size={15} />
                    Create {!p ? "project" : !f ? "feature" : "endpoint"}
                  </Button>
                </div>
              )}
            </section>
          </motion.div>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {modal && (
        <Modal
          title={`${modal.kind === "try" ? "Try request" : `${modal.value ? "Edit" : "Create"} ${modal.kind}`}`}
          onClose={() => setModal(null)}
        >
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {["project", "feature", "endpoint"].includes(modal.kind) && (
            <EntityForm
              kind={modal.kind as "project" | "feature" | "endpoint"}
              value={
                "value" in modal
                  ? (modal.value as Project | Feature | Endpoint)
                  : undefined
              }
              onSave={saveEntity}
              busy={save.isPending}
            />
          )}{" "}
          {modal.kind === "response" && (
            <ResponseForm
              value={modal.value}
              onSave={saveResponse}
              busy={save.isPending}
            />
          )}{" "}
          {modal.kind === "scenario" && e && (
            <ScenarioForm
              value={modal.value}
              responses={e.responses}
              onSave={saveScenario}
              busy={save.isPending}
            />
          )}{" "}
          {modal.kind === "try" && e && p && (
            <TryForm
              endpoint={e}
              project={p.id}
              environment={env}
              onDone={() => void logs.refetch()}
            />
          )}{" "}
        </Modal>
      )}
    </div>
  );
}
