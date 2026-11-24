import { ChevronRight, Code2, MoreHorizontal, Search, X } from "lucide-react";
import type { Endpoint, Feature } from "../../api";
import { Button } from "../ui/button";

type Props = {
  feature?: Feature;
  endpoint?: Endpoint;
  mockingPaused: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
};

export function EndpointList({
  feature,
  endpoint,
  mockingPaused,
  search,
  onSearchChange,
  onSelect,
}: Props) {
  return (
    <section className="endpoint-list panel">
      <div className="panel-heading">
        <h2>
          Endpoints <span>{feature?.endpoints.length || 0}</span>
        </h2>
        <MoreHorizontal size={18} />
      </div>
      <div className="search">
        <Search size={15} />
        <input
          aria-label="Search endpoints"
          placeholder="Search endpoints…"
          value={search}
          onChange={(ev) => onSearchChange(ev.target.value)}
        />
        {search && (
          <button
            className="search-clear"
            aria-label="Clear endpoint search"
            onClick={() => onSearchChange("")}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="endpoint-items">
        {feature?.endpoints
          .filter((v) =>
            (v.name + v.path + v.method)
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((v) => (
            <button
              key={v.id}
              className={`endpoint-item ${endpoint?.id === v.id ? "active" : ""}`}
              aria-current={endpoint?.id === v.id ? "true" : undefined}
              onClick={() => onSelect(v.id)}
            >
              <div>
                <span className={`method ${v.method.toLowerCase()}`}>
                  {v.method}
                </span>
                <span
                  className={
                    v.enabled && !mockingPaused ? "enabled-dot" : "disabled-dot"
                  }
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
        {!!feature?.endpoints.length &&
          !feature.endpoints.some((endpoint) =>
            (endpoint.name + endpoint.path + endpoint.method)
              .toLowerCase()
              .includes(search.toLowerCase()),
          ) && (
            <div className="empty compact">
              <Search size={22} />
              <h3>No matching endpoints</h3>
              <p>Try a method, name, or API path.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSearchChange("")}
              >
                Clear search
              </Button>
            </div>
          )}
        {!feature?.endpoints.length && (
          <div className="empty compact">
            <Code2 />
            <h3>No endpoints yet</h3>
            <p>Add your first method and API path.</p>
          </div>
        )}
      </div>
    </section>
  );
}
