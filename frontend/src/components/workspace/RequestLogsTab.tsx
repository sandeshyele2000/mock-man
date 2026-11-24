import { Activity, ChevronDown, RotateCcw } from "lucide-react";
import type { Endpoint, Log } from "../../api";
import { JsonPreview } from "../JsonPreview";
import { Button } from "../ui/button";

type Props = {
  endpoint: Endpoint;
  logs?: Log[];
  pending: boolean;
  error: Error | null;
  onRefresh: () => void;
};

export function RequestLogsTab({
  endpoint,
  logs,
  pending,
  error,
  onRefresh,
}: Props) {
  return (
    <>
      <div className="section-heading">
        <div>
          <h3>Request activity</h3>
          <p>Matched requests · refreshes every 2 seconds</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void onRefresh()}>
          <RotateCcw size={13} />
          Refresh
        </Button>
      </div>
      {error && (
        <p className="error" role="alert">
          Could not load logs: {error?.message}
        </p>
      )}
      <div className="log-list">
        {logs
          ?.filter((v) => v.detail.endpoint === endpoint.id)
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
                <time>{new Date(l.createdAt).toLocaleTimeString()}</time>
                <ChevronDown size={13} />
              </summary>
              <dl>
                <dt>Request</dt>
                <dd>
                  <code>
                    {l.detail.method} {l.detail.path}
                  </code>
                </dd>
                <dt>Session</dt>
                <dd>{l.detail.session}</dd>
                {l.detail.feature && (
                  <>
                    <dt>Feature</dt>
                    <dd>{l.detail.feature}</dd>
                  </>
                )}
                <dt>Scenario</dt>
                <dd>{l.detail.scenario}</dd>
                <dt>Revision</dt>
                <dd>{l.detail.revision}</dd>
                <dt>Matched rule</dt>
                <dd>{l.detail.reason}</dd>
              </dl>
              <section className="log-payload" aria-label="Request payload">
                <div className="log-payload-heading">
                  <h4>Request payload</h4>
                  {l.detail.payload && (
                    <span>
                      {l.detail.payload.sizeBytes.toLocaleString()} bytes
                      {l.detail.payload.contentType
                        ? ` · ${l.detail.payload.contentType}`
                        : ""}
                    </span>
                  )}
                </div>
                {!l.detail.payload ? (
                  <p>Payload was not recorded for this request.</p>
                ) : l.detail.payload.sizeBytes === 0 ? (
                  <p>No request body.</p>
                ) : (
                  <>
                    {l.detail.payload.encoding === "base64" && (
                      <p>Binary payload · displayed as base64.</p>
                    )}
                    {l.detail.payload.truncated && (
                      <p className="payload-truncated">
                        Showing the first 64 KiB at most. The full request body
                        was used for matching.
                      </p>
                    )}
                    <JsonPreview text={l.detail.payload.body} />
                  </>
                )}
              </section>
            </details>
          ))}
      </div>
      {!pending && !logs?.some((v) => v.detail.endpoint === endpoint.id) && (
        <div className="empty">
          <Activity />
          <h3>Waiting for your first request</h3>
          <p>Use Try request or call the mock listener from your app.</p>
        </div>
      )}
      <p className="footnote">
        Logs record the allocated response before delay. Disconnected requests
        still consume their attempt.
      </p>
    </>
  );
}
