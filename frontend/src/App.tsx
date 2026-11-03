import {
  Modal,
  EntityForm,
  ResponseForm,
  ScenarioForm,
  TryForm,
  behaviors,
} from "./components/editors";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Copy,
  Folder,
  Layers,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Server,
  Settings2,
  Trash2,
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
const pretty = (v: unknown) => JSON.stringify(v, null, 2);
type ModalState =
  | { kind: "project"; value?: Project }
  | { kind: "feature"; value?: Feature }
  | { kind: "endpoint"; value?: Endpoint }
  | { kind: "response"; value?: Response }
  | { kind: "scenario"; value?: Scenario }
  | { kind: "try" }
  | { kind: "reset" };
export default function App() {
  const client = useQueryClient();
  const config = useQuery({ queryKey: ["config"], queryFn: loadConfig });
  const [projectID, setProjectID] = useState("demo");
  const [featureID, setFeatureID] = useState("");
  const [endpointID, setEndpointID] = useState("");
  const [environment, setEnvironment] = useState("development");
  const [session, setSession] = useState("default");
  const [tab, setTab] = useState("responses");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalState | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
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
  function saveScenario(v: Scenario) {
    change((_, __, ___, e) => {
      if (!e) return;
      const i = e.scenarios.findIndex((s) => s.id === v.id);
      if (i < 0) e.scenarios.push(v);
      else e.scenarios[i] = v;
      if (!e.active[env]) e.active[env] = v.id;
    });
  }
  const reset = useMutation({
    mutationFn: (scope: string) =>
      api("/api/reset", "POST", {
        project: p?.id,
        environment: env,
        session: scope === "environment" ? "" : session,
        endpoint: scope === "endpoint" ? e?.id : "",
      }),
    onSuccess: () => {
      setModal(null);
      setNotice("Attempts reset. The next matched request starts at 1.");
      void client.invalidateQueries({ queryKey: ["logs"] });
    },
    onError: (err) => setError(err.message),
  });
  const active = e?.scenarios.find((s) => s.id === e.active[env]);
  const validSession = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(session);
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const curl =
    e && p
      ? [
        `curl -i -X ${e.method} ${quote(`http://127.0.0.1:9090${encodeURI(e.path)}`)}`,
        `  -H ${quote(`X-Mock-Project: ${p.id}`)}`,
        `  -H ${quote(`X-Mock-Environment: ${env}`)}`,
        `  -H ${quote(`X-Mock-Session: ${session}`)}`,
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
        <Box size={32} />
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
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Box size={23} />
          </span>
          mockman<span className="beta">LOCAL</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <div className="project-select">
          <Layers size={17} />
          <select
            aria-label="Project"
            value={p?.id || ""}
            onChange={(ev) => {
              setProjectID(ev.target.value);
              setFeatureID("");
              setEndpointID("");
            }}
          >
            {c?.projects.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
            {!p && <option>No projects yet</option>}
          </select>
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
                    next.projects = next.projects.filter((v) => v.id !== p.id);
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
                onClick={() => {
                  setFeatureID(feature.id);
                  setEndpointID("");
                }}
              >
                <Folder size={16} />
                <span>{feature.name}</span>
                <span className="count">{feature.endpoints.length}</span>
                {f?.id === feature.id ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </button>
              {f?.id === feature.id &&
                feature.endpoints.map((endpoint) => (
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
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="server-state">
            <span className="live-dot" />
            <span>Local workspace</span>
            <span className="port">:9090</span>
          </div>
          <p>
            Predictable APIs.
            <br />
            More productive development.
          </p>
          <div className="version">
            <span>Mockman</span>
            <span>v0.1</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <span>{p?.name || "Get started"}</span>
            <ChevronRight size={13} />
            <b>{f?.name || "Features"}</b>
          </div>
          <div className="top-context">
            <span className="live-dot" />
            <select
              aria-label="Environment"
              value={env}
              onChange={(ev) => setEnvironment(ev.target.value)}
            >
              {p?.environments.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <span className="divider" />
            <span className="local-pill">LOCAL ONLY</span>
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
              <p>Shape the response. Test every possibility.</p>
            </div>
            <div className="heading-actions">
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
          <div className="content-grid">
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
              <div className="list-footer">
                <Server size={14} />
                <span>
                  Mock server <code>localhost:9090</code>
                </span>
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
                      disabled={!validSession}
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
                                  aria-label={`Edit scenario ${s.name}`}
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
                              {behaviors[s.behavior]}
                              {["failFirst", "failAfter"].includes(
                                s.behavior,
                              ) && <b> · N = {s.count}</b>}
                              {s.behavior === "sequence" &&
                                ` · ${s.exhaustion === "loop" ? "Loop" : "Repeat final"}`}
                            </p>
                            <div className="response-flow">
                              {s.responseIds.map((rid, i) => (
                                <span key={i}>
                                  {i > 0 && <ArrowRight size={13} />}
                                  <code>
                                    {
                                      e.responses.find((r) => r.id === rid)
                                        ?.name
                                    }
                                  </code>
                                </span>
                              ))}
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
                                  <dt>Session</dt>
                                  <dd>{l.detail.session}</dd>
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
                              Dashboard: 127.0.0.1:8080
                              <br />
                              Mock API: 127.0.0.1:9090
                            </p>
                            <p>
                              Set MOCK_ADDR=0.0.0.0:9090 for a physical device.
                              Use your computer’s LAN address. Keep real
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
                  <Box size={36} />
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
          </div>
          <div className="session-bar">
            <div>
              <span className="session-icon">
                <Settings2 size={16} />
              </span>
              <span>
                <b>Test session</b>
                <small>Attempts are isolated by session and environment.</small>
              </span>
            </div>
            <label>
              Session ID
              <input
                aria-label="Session ID"
                aria-invalid={!validSession}
                maxLength={64}
                value={session}
                onChange={(ev) => setSession(ev.target.value)}
                pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}"
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              disabled={!p || !validSession}
              onClick={() => setModal({ kind: "reset" })}
            >
              <RotateCcw size={13} />
              Reset attempts
            </Button>
          </div>
          {!validSession && (
            <p role="alert" className="error">
              Session IDs need 1–64 letters, numbers, underscores or hyphens,
              starting with a letter or number.
            </p>
          )}
          <div className="page-footer">
            <span>
              <span className="live-dot" />
              Your configuration stays in PostgreSQL.
            </span>
            <span>Made for the edge cases.</span>
          </div>
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
          title={`${modal.kind === "try" ? "Try request" : modal.kind === "reset" ? "Reset attempt counters" : `${modal.value ? "Edit" : "Create"} ${modal.kind}`}`}
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
              session={session}
              onDone={() => void logs.refetch()}
            />
          )}{" "}
          {modal.kind === "reset" && (
            <div>
              <p className="muted">
                Existing logs remain available. In-flight requests finish with
                their already selected response.
              </p>
              <div className="reset-options">
                <Button
                  variant="outline"
                  disabled={reset.isPending}
                  onClick={() => reset.mutate("endpoint")}
                >
                  This endpoint · session {session}
                </Button>
                <Button
                  variant="outline"
                  disabled={reset.isPending}
                  onClick={() => reset.mutate("session")}
                >
                  All endpoints · session {session}
                </Button>
                <Button
                  variant="destructive"
                  disabled={reset.isPending}
                  onClick={() => reset.mutate("environment")}
                >
                  Entire {env} environment
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
