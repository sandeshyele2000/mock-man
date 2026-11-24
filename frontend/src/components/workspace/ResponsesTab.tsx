import { Code2, Eye, Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { Endpoint, Response } from "../../api";
import { JsonPreview } from "../JsonPreview";
import { Button } from "../ui/button";
import type { ModalState } from "./types";

type Props = {
  endpoint: Endpoint;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenModal: (modal: ModalState) => void;
  onDelete: (response: Response) => void;
};

export function ResponsesTab({
  endpoint,
  search,
  onSearchChange,
  onOpenModal,
  onDelete,
}: Props) {
  const pretty = (value: unknown) => JSON.stringify(value, null, 2);
  const responseQuery = search.trim().toLowerCase();
  const filteredResponses = (endpoint?.responses ?? []).filter((response) =>
    [
      response.name,
      response.status,
      response.delayMs,
      pretty(response.body),
      pretty(response.headers),
    ]
      .join(" ")
      .toLowerCase()
      .includes(responseQuery),
  );

  return (
    <>
      <div className="section-heading">
        <div>
          <h3>Named responses</h3>
          <p>The building blocks for every scenario.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenModal({ kind: "response" })}
        >
          <Plus size={14} />
          Add response
        </Button>
      </div>
      <label className="list-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          aria-label="Search responses"
          placeholder="Search responses…"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>
      {filteredResponses.map((r) => (
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
              <span className="delay">{r.delayMs.toLocaleString()} ms</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`View response ${r.name}`}
                onClick={() =>
                  onOpenModal({
                    kind: "response-view",
                    value: r,
                  })
                }
              >
                <Eye size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit response ${r.name}`}
                onClick={() => onOpenModal({ kind: "response", value: r })}
              >
                <Pencil size={13} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete response ${r.name}`}
                onClick={() => onDelete(r)}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          </div>
          <JsonPreview text={pretty(r.body)} />
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
      {endpoint.responses.length === 0 && (
        <div className="empty">
          <Code2 />
          <h3>Give this endpoint a response</h3>
          <p>Define a status, JSON body and optional delay.</p>
        </div>
      )}
      {endpoint.responses.length > 0 && filteredResponses.length === 0 && (
        <div className="empty list-empty">
          <Search />
          <h3>No matching responses</h3>
          <p>Try a different search term.</p>
        </div>
      )}
    </>
  );
}
