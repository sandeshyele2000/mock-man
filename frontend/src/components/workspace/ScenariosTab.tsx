import {
  ArrowRight,
  Check,
  Download,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import { useRef } from "react";
import type { Endpoint, Log, Scenario } from "../../api";
import { behaviors } from "../../scenarioBehaviors";
import { Button } from "../ui/button";
import type { ModalState } from "./types";

type Props = {
  endpoint: Endpoint;
  active?: Scenario;
  env: string;
  logs: Log[];
  busy: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenModal: (modal: ModalState) => void;
  onDelete: (scenario: Scenario) => void;
  onActivate: (scenario: Scenario) => void;
  onImport: (file?: File) => Promise<void>;
  onExport: (scenario: Scenario) => void;
};

export function ScenariosTab({
  endpoint,
  active,
  env,
  logs,
  busy,
  search,
  onSearchChange,
  onOpenModal,
  onDelete,
  onActivate,
  onImport,
  onExport,
}: Props) {
  const scenarioImportRef = useRef<HTMLInputElement>(null);
  async function handleImport(file?: File) {
    try {
      await onImport(file);
    } finally {
      if (scenarioImportRef.current) scenarioImportRef.current.value = "";
    }
  }
  function nextResponseIndex(scenario: Scenario) {
    const latest = logs?.find(
      (log) =>
        log.detail.endpoint === endpoint?.id &&
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
  const scenarioQuery = search.trim().toLowerCase();
  const filteredScenarios = (endpoint?.scenarios ?? []).filter((scenario) => {
    const responseNames = scenario.responseIds
      .map(
        (responseID) =>
          endpoint?.responses.find((response) => response.id === responseID)
            ?.name,
      )
      .filter(Boolean);
    return [
      scenario.name,
      scenario.behavior,
      behaviors[scenario.behavior as keyof typeof behaviors],
      scenario.count,
      scenario.exhaustion,
      ...responseNames,
      ...scenario.conditions.map(
        (condition) =>
          `${condition.source} ${condition.key} ${condition.value}`,
      ),
    ]
      .join(" ")
      .toLowerCase()
      .includes(scenarioQuery);
  });

  return (
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
            onChange={(event) => void handleImport(event.target.files?.[0])}
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
            disabled={!endpoint.responses.length}
            onClick={() => onOpenModal({ kind: "scenario" })}
          >
            <Plus size={14} />
            Add scenario
          </Button>
        </div>
      </div>
      <label className="list-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          aria-label="Search scenarios"
          placeholder="Search scenarios…"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>
      {filteredScenarios.map((s) => (
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
                onClick={() => onExport(s)}
              >
                <Download size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit scenario ${s.name}`}
                disabled={!Object.hasOwn(behaviors, s.behavior)}
                onClick={() => onOpenModal({ kind: "scenario", value: s })}
              >
                <Pencil size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete scenario ${s.name}`}
                onClick={() => onDelete(s)}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
          <p>
            {behaviors[s.behavior as keyof typeof behaviors] ??
              "Visual flow (view only)"}
            {["failFirst", "failAfter"].includes(s.behavior) && (
              <b> · N = {s.count}</b>
            )}
            {s.behavior === "sequence" &&
              ` · ${s.exhaustion === "loop" ? "Loop" : "Repeat final"}`}
          </p>
          <div className="response-flow">
            {s.responseIds.map((rid, i) => {
              const isNext =
                s.id === active?.id &&
                s.behavior !== "flow" &&
                s.behavior !== "javascript" &&
                i === nextResponseIndex(s);
              return (
                <span className={isNext ? "is-next" : undefined} key={i}>
                  {i > 0 && <ArrowRight size={13} />}
                  <code>
                    {endpoint.responses.find((r) => r.id === rid)?.name}
                  </code>
                  {isNext && <small className="step-state">NEXT</small>}
                </span>
              );
            })}
          </div>
          {s.conditions.length > 0 && (
            <p className="conditions-preview">
              {s.conditions
                .map((c) => `${c.source}.${c.key} = ${c.value}`)
                .join(" AND ")}{" "}
              · priority {s.priority}
            </p>
          )}
          <div className="scenario-footer">
            <small>Revision {s.revision.slice(0, 8)}</small>
            <Button
              variant={s.id === active?.id ? "ghost" : "outline"}
              size="sm"
              disabled={busy || s.id === active?.id}
              onClick={() => onActivate(s)}
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
      {endpoint.scenarios.length === 0 && (
        <div className="empty">
          <Zap />
          <h3>No scenario selected</h3>
          <p>
            {endpoint.responses.length
              ? "Add a scenario to start serving requests."
              : "Add a response first, then define its behavior."}
          </p>
        </div>
      )}
      {endpoint.scenarios.length > 0 && filteredScenarios.length === 0 && (
        <div className="empty list-empty">
          <Search />
          <h3>No matching scenarios</h3>
          <p>Try a different search term.</p>
        </div>
      )}
    </>
  );
}
