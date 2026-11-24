import { Check, Pencil, Play, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Endpoint, Feature, Project, Scenario } from "../../api";
import { MockmanMark } from "../brand";
import { Button } from "../ui/button";
import type { ModalState, WorkspaceTab } from "./types";

type Props = {
  endpoint?: Endpoint;
  project?: Project;
  feature?: Feature;
  environment: string;
  active?: Scenario;
  mockingPaused: boolean;
  busy: boolean;
  tab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  requestCount: number;
  onOpenModal: (modal: ModalState) => void;
  onDelete: (endpoint: Endpoint) => void;
  onToggleMocking: (enabled: boolean) => void;
  children: ReactNode;
};

export function EndpointDetail({
  endpoint,
  project,
  feature,
  environment,
  active,
  mockingPaused,
  busy,
  tab,
  onTabChange,
  requestCount,
  onOpenModal,
  onDelete,
  onToggleMocking,
  children,
}: Props) {
  return (
    <section className="endpoint-detail panel">
      {endpoint ? (
        <>
          <div className="detail-heading">
            <div className="route">
              <span className={`method ${endpoint.method.toLowerCase()}`}>
                {endpoint.method}
              </span>
              <code>{endpoint.path}</code>
            </div>
            <div className="detail-tools">
              <label className="toggle">
                <input
                  type="checkbox"
                  aria-label="Mocking enabled"
                  checked={endpoint.enabled}
                  disabled={busy}
                  onChange={(event) => onToggleMocking(event.target.checked)}
                />
                <span />
                {endpoint.enabled
                  ? mockingPaused
                    ? "Mocking paused"
                    : "Mocking on"
                  : "Mocking off"}
              </label>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit endpoint"
                onClick={() =>
                  onOpenModal({ kind: "endpoint", value: endpoint })
                }
              >
                <Pencil size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete endpoint"
                onClick={() => onDelete(endpoint)}
              >
                <Trash2 size={15} />
              </Button>
            </div>
          </div>
          <div className="detail-subheading">
            <h2>{endpoint.name}</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenModal({ kind: "try" })}
            >
              <Play size={13} />
              Try request
            </Button>
          </div>
          <div className="tabs" role="tablist">
            {[
              ["responses", "Responses", endpoint.responses.length],
              ["scenarios", "Scenarios", endpoint.scenarios.length],
              ["logs", "Request logs", requestCount],
              ["connect", "Connect", null],
            ].map(([v, label, n]) => (
              <button
                key={v}
                role="tab"
                aria-selected={tab === v}
                className={tab === v ? "selected" : ""}
                onClick={() => onTabChange(v as WorkspaceTab)}
              >
                {label}
                {n !== null && <span>{n}</span>}
              </button>
            ))}
          </div>
          <div className="tab-content">{children}</div>
          <div className="detail-bottom">
            <span className="live-dot" />
            <span>
              {active ? active.name : "No active scenario"}
              <small> in {environment}</small>
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
            {project ? "Build your first mock API" : "Welcome to Mockman"}
          </h3>
          <p>
            {feature
              ? "Create an endpoint to configure responses and scenarios."
              : project
                ? "Create a feature to group related endpoints."
                : "Create a project to organize your API workspace."}
          </p>
          <Button
            onClick={() =>
              onOpenModal({
                kind: !project ? "project" : !feature ? "feature" : "endpoint",
              })
            }
          >
            <Plus size={15} />
            Create {!project ? "project" : !feature ? "feature" : "endpoint"}
          </Button>
        </div>
      )}
    </section>
  );
}
