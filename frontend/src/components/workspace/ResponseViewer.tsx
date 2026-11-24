import { Pencil, Trash2 } from "lucide-react";
import type { Response } from "../../api";
import { JsonPreview } from "../JsonPreview";
import { Button } from "../ui/button";

type Props = {
  response: Response;
  busy: boolean;
  onDelete: (response: Response) => void;
  onEdit: (response: Response) => void;
};

export function ResponseViewer({ response, busy, onDelete, onEdit }: Props) {
  const pretty = (value: unknown) => JSON.stringify(value, null, 2);
  return (
    <div className="response-viewer">
      <div className="response-viewer-meta">
        <span
          className={`status ${response.status >= 400 ? "failure" : "success"}`}
        >
          HTTP {response.status}
        </span>
        <span className="muted">
          {response.delayMs.toLocaleString()} ms delay
        </span>
      </div>
      <div className="response-viewer-content">
        <section
          className="response-viewer-body"
          aria-label="Response JSON body"
        >
          <h3>Response body</h3>
          <JsonPreview text={pretty(response.body)} />
        </section>
        <details className="response-viewer-headers">
          <summary>
            Response headers ({Object.keys(response.headers).length})
          </summary>
          <JsonPreview text={pretty(response.headers)} />
        </details>
      </div>
      <div className="response-viewer-actions">
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() => onDelete(response)}
        >
          <Trash2 size={15} />
          Delete response
        </Button>
        <Button disabled={busy} onClick={() => onEdit(response)}>
          <Pencil size={15} />
          Edit response
        </Button>
      </div>
    </div>
  );
}
