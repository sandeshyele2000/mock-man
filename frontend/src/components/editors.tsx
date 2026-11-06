// Created by Sandesh
import {
  cloneElement,
  isValidElement,
  lazy,
  Suspense,
  useId,
  type ReactElement,
} from "react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, X, Plus, Play } from "lucide-react";
import {
  api,
  type Project,
  type Feature,
  type Endpoint,
  type Response,
  type Scenario,
  type Condition,
  type TryResult,
} from "../api";
import { Button } from "./ui/button";
import { SelectField } from "./ui/select";
const id = () => crypto.randomUUID().slice(0, 8);
const pretty = (v: unknown) => JSON.stringify(v, null, 2);
export const behaviors = {
  always: "Always return",
  failFirst: "Fail first N attempts",
  failAfter: "Fail after N attempts",
  sequence: "Response sequence",
  javascript: "Custom",
};
const JavaScriptCodeEditor = lazy(() =>
  import("./JavaScriptCodeEditor").then((module) => ({
    default: module.JavaScriptCodeEditor,
  })),
);
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  return (
    <div className="field">
      <label id={labelId} htmlFor={fieldId}>
        {label}
      </label>
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{
              id?: string;
              "aria-describedby"?: string;
              "aria-labelledby"?: string;
            }>,
            {
              id: fieldId,
              "aria-describedby": hint ? `${fieldId}-hint` : undefined,
              "aria-labelledby": labelId,
            },
          )
        : children}
      {hint && <small id={`${fieldId}-hint`}>{hint}</small>}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={18} />
        </Button>
      </header>
      {children}
    </dialog>
  );
}
function Form({
  children,
  onSave,
  busy,
}: {
  children: ReactNode;
  onSave: () => void;
  busy: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      {children}
      <footer>
        <span>Changes are saved to this workspace.</span>
        <Button disabled={busy} type="submit">
          {busy ? "Saving…" : "Save changes"}
          <Check size={15} />
        </Button>
      </footer>
    </form>
  );
}
export function EntityForm({
  kind,
  value,
  onSave,
  busy,
}: {
  kind: "project" | "feature" | "endpoint";
  value?: Project | Feature | Endpoint;
  onSave: (v: Project | Feature | Endpoint) => void;
  busy: boolean;
}) {
  const [name, setName] = useState(value?.name || "");
  const [ident, setIdent] = useState(value?.id || id());
  const e = value as Endpoint | undefined;
  const [method, setMethod] = useState<Endpoint["method"]>(e?.method || "GET");
  const [path, setPath] = useState(e?.path || "/v1/");
  const [envs, setEnvs] = useState(
    (value as Project)?.environments?.join(", ") || "development, staging",
  );
  return (
    <Form
      busy={busy}
      onSave={() => {
        if (kind === "project")
          onSave({
            ...value,
            id: ident,
            name,
            environments: envs
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            features: (value as Project)?.features || [],
          });
        if (kind === "feature")
          onSave({
            ...value,
            id: ident,
            name,
            endpoints: (value as Feature)?.endpoints || [],
          });
        if (kind === "endpoint")
          onSave({
            id: ident,
            name,
            method,
            path,
            enabled: e?.enabled ?? true,
            responses: e?.responses || [],
            scenarios: e?.scenarios || [],
            active: e?.active || {},
          });
      }}
    >
      <Field label="Name">
        <input
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`Name your ${kind}`}
        />
      </Field>
      <Field
        label="Identifier"
        hint="Letters, numbers, underscores and hyphens; maximum 64 characters."
      >
        <input
          required
          pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}"
          disabled={!!value}
          value={ident}
          onChange={(e) => setIdent(e.target.value)}
        />
      </Field>
      {kind === "project" && (
        <Field
          label="Environments"
          hint="Comma-separated IDs. Remove active selections before removing an environment."
        >
          <input
            required
            value={envs}
            onChange={(e) => setEnvs(e.target.value)}
          />
        </Field>
      )}
      {kind === "endpoint" && (
        <div className="form-grid">
          <Field label="Method">
            <SelectField
              value={method}
              onValueChange={(v) => setMethod(v as Endpoint["method"])}
              options={[
                "GET",
                "POST",
                "PUT",
                "PATCH",
                "DELETE",
                "HEAD",
                "OPTIONS",
              ].map((m) => ({ value: m, label: m }))}
            />
          </Field>
          <Field label="API path">
            <input
              required
              pattern="/.*"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
          </Field>
        </div>
      )}
    </Form>
  );
}
export function ResponseForm({
  value,
  onSave,
  busy,
}: {
  value?: Response;
  onSave: (v: Response) => void;
  busy: boolean;
}) {
  const [name, setName] = useState(value?.name || "");
  const [status, setStatus] = useState(value?.status || 200);
  const [delay, setDelay] = useState(value?.delayMs || 0);
  const [body, setBody] = useState(pretty(value?.body ?? {}));
  const [headers, setHeaders] = useState(
    pretty(value?.headers || { "Content-Type": "application/json" }),
  );
  const [error, setError] = useState("");
  return (
    <Form
      busy={busy}
      onSave={() => {
        try {
          const h = JSON.parse(headers);
          if (
            !h ||
            typeof h !== "object" ||
            Array.isArray(h) ||
            Object.values(h).some((v) => typeof v !== "string")
          )
            throw Error("Headers must be a JSON object of string values.");
          onSave({
            id: value?.id || id(),
            name,
            status,
            delayMs: delay,
            headers: h,
            body: JSON.parse(body),
          });
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <Field label="Response name">
        <input
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Accepted"
        />
      </Field>
      <div className="form-grid">
        <Field label="Status code">
          <input
            type="number"
            required
            min={200}
            max={599}
            value={status}
            onChange={(e) => setStatus(+e.target.value)}
          />
        </Field>
        <Field label="Delay (ms)">
          <input
            type="number"
            required
            min={0}
            max={30000}
            value={delay}
            onChange={(e) => setDelay(+e.target.value)}
          />
        </Field>
      </div>
      <Field label="Headers (JSON)">
        <textarea
          className="code"
          rows={3}
          value={headers}
          onChange={(e) => setHeaders(e.target.value)}
          spellCheck={false}
        />
      </Field>
      <Field
        label="Response body (JSON)"
        hint="Returned exactly as configured. HEAD, 204, 205 and 304 responses omit the body."
      >
        <textarea
          className="code"
          rows={9}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck={false}
        />
      </Field>
      {error && (
        <p role="alert" className="error">
          Invalid JSON: {error}
        </p>
      )}
    </Form>
  );
}
export function ScenarioForm({
  value,
  responses,
  onSave,
  busy,
  theme,
}: {
  value?: Scenario;
  responses: Response[];
  onSave: (v: Scenario) => void;
  busy: boolean;
  theme: "light" | "dark";
}) {
  const [name, setName] = useState(value?.name || "");
  const [behavior, setBehavior] = useState<Scenario["behavior"]>(
    value?.behavior || "always",
  );
  const [count, setCount] = useState(value?.count ?? 3);
  const [ids, setIds] = useState<string[]>(
    value?.responseIds || [responses[0]?.id || ""],
  );
  const [exhaustion, setExhaustion] = useState<Scenario["exhaustion"]>(
    value?.exhaustion || "repeat",
  );
  const [priority, setPriority] = useState(value?.priority || 0);
  const [conditions, setConditions] = useState<Condition[]>(
    value?.conditions || [],
  );
  const [code, setCode] = useState(
    value?.code ||
      'const expiresAt = _.get(request.body, "expiresAt");\nconst expired = expiresAt && moment(expiresAt).isBefore(moment());\nconst chosen = input.responses.find((response) => response.name === (expired ? "Expired" : "Active"));\nreturn { responseId: chosen?.id ?? input.responses[0]?.id };',
  );
  const responseSelect = (i: number, label: string) => (
    <Field key={i} label={label}>
      <SelectField
        value={ids[i] || ""}
        onValueChange={(value) =>
          setIds((prev) => {
            const v = [...prev];
            v[i] = value;
            return v;
          })
        }
        placeholder="Select a response"
        options={responses.map((r) => ({
          value: r.id,
          label: `${r.name} · ${r.status}`,
        }))}
      />
    </Field>
  );
  return (
    <Form
      busy={busy}
      onSave={() =>
        onSave({
          id: value?.id || id(),
          name,
          revision: value?.revision || "",
          behavior,
          count: behavior === "javascript" ? 0 : count,
          responseIds: ids,
          exhaustion,
          priority,
          conditions,
          code: behavior === "javascript" ? code : undefined,
        })
      }
    >
      <Field label="Scenario name">
        <input
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Retry then succeed"
        />
      </Field>
      <Field label="Behavior">
        <SelectField
          value={behavior}
          onValueChange={(value) => {
            const b = value as Scenario["behavior"];
            setBehavior(b);
            setIds(
              b === "always"
                ? [responses[0]?.id || ""]
                : b === "javascript"
                  ? responses.map((response) => response.id)
                  : [
                      responses[0]?.id || "",
                      responses[1]?.id || responses[0]?.id || "",
                    ],
            );
          }}
          options={Object.entries(behaviors).map(([value, label]) => ({
            value,
            label,
          }))}
        />
      </Field>
      {(behavior === "failFirst" || behavior === "failAfter") && (
        <>
          <Field
            label="Attempt threshold"
            hint={
              behavior === "failFirst"
                ? `Attempts 1–${count} fail; attempt ${count + 1} onward succeeds.`
                : `Attempts 1–${count} succeed; attempt ${count + 1} onward fails.`
            }
          >
            <input
              type="number"
              min={0}
              max={1000000}
              required
              value={count}
              onChange={(e) => setCount(+e.target.value)}
            />
          </Field>
          <div className="form-grid">
            {responseSelect(0, "Failure response")}
            {responseSelect(1, "Success response")}
          </div>
        </>
      )}
      {behavior === "always" && responseSelect(0, "Response")}
      {behavior === "javascript" && (
        <>
          <Field
            label="JavaScript code"
            hint="Available globals: request, input, responses, attempt, session, environment, _, moment. Return { responseId } or { response: { status, headers, body, delayMs } }."
          >
            <Suspense
              fallback={
                <div className="javascript-editor-loading">
                  Loading JavaScript editor…
                </div>
              }
            >
              <JavaScriptCodeEditor
                value={code}
                onChange={setCode}
                theme={theme}
              />
            </Suspense>
          </Field>
          <div className="script-response-options">
            <strong>Available responses</strong>
            {responses.map((response) => (
              <div key={response.id}>
                <span>
                  {response.name} · {response.status}
                </span>
                <code>{response.id}</code>
              </div>
            ))}
          </div>
        </>
      )}
      {behavior === "sequence" && (
        <>
          <div className="sequence">
            {ids.map((_, i) => (
              <div className="sequence-row" key={i}>
                {responseSelect(i, `Attempt ${i + 1}`)}
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  disabled={ids.length < 2}
                  aria-label={`Remove step ${i + 1}`}
                  onClick={() => setIds(ids.filter((_, j) => j !== i))}
                >
                  <X size={15} />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setIds([...ids, responses[0]?.id || ""])}
            >
              <Plus size={14} />
              Add step
            </Button>
          </div>
          <Field label="When the sequence ends">
            <SelectField
              value={exhaustion}
              onValueChange={(value) =>
                setExhaustion(value as Scenario["exhaustion"])
              }
              options={[
                { value: "repeat", label: "Repeat final response" },
                { value: "loop", label: "Loop sequence" },
              ]}
            />
          </Field>
        </>
      )}
      <div className="section-label">
        Request conditions <span>Optional · all must match</span>
      </div>
      {conditions.map((c, i) => (
        <div className="condition" key={i}>
          <SelectField
            aria-label={`Condition ${i + 1} source`}
            value={c.source}
            onValueChange={(value) =>
              setConditions(
                conditions.map((v, j) =>
                  j === i ? { ...v, source: value as Condition["source"] } : v,
                ),
              )
            }
            options={[
              { value: "query", label: "Query" },
              { value: "header", label: "Header" },
              { value: "body", label: "JSON body" },
            ]}
          />
          <input
            aria-label={`Condition ${i + 1} key`}
            required
            placeholder="Key / dotted field"
            value={c.key}
            onChange={(e) =>
              setConditions(
                conditions.map((v, j) =>
                  j === i ? { ...v, key: e.target.value } : v,
                ),
              )
            }
          />
          <input
            aria-label={`Condition ${i + 1} value`}
            placeholder="Equals"
            value={c.value}
            onChange={(e) =>
              setConditions(
                conditions.map((v, j) =>
                  j === i ? { ...v, value: e.target.value } : v,
                ),
              )
            }
          />
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label="Remove condition"
            onClick={() => setConditions(conditions.filter((_, j) => j !== i))}
          >
            <X size={14} />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() =>
          setConditions([
            ...conditions,
            { source: "query", key: "", value: "" },
          ])
        }
      >
        <Plus size={14} />
        Add condition
      </Button>
      <Field
        label="Rule priority"
        hint="Higher numbers match first. Overlapping conditional rules require different priorities. The active scenario is the fallback."
      >
        <input
          type="number"
          min={-1000000}
          max={1000000}
          value={priority}
          onChange={(e) => setPriority(+e.target.value)}
        />
      </Field>
    </Form>
  );
}
export function TryForm({
  endpoint,
  project,
  environment,
  onDone,
}: {
  endpoint: Endpoint;
  project: string;
  environment: string;
  onDone: () => void;
}) {
  const [path, setPath] = useState(endpoint.path);
  const [body, setBody] = useState("{}");
  const [headers, setHeaders] = useState("{}");
  const [scenario, setScenario] = useState("");
  const [error, setError] = useState("");
  const request = useMutation({
    mutationFn: async () => {
      const h = JSON.parse(headers);
      if (
        !h ||
        Array.isArray(h) ||
        typeof h !== "object" ||
        Object.values(h).some((v) => typeof v !== "string")
      )
        throw Error("Headers must be a JSON object of strings");
      return api<TryResult>("/api/try", "POST", {
        method: endpoint.method,
        path,
        body,
        headers: h,
        scenario,
        project,
        environment,
      });
    },
    onSuccess: onDone,
  });
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setError("");
        request.mutate();
      }}
    >
      <Field label={`${endpoint.method} · Request path and query`}>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          required
        />
      </Field>
      <Field label="Scenario override">
        <SelectField
          value={scenario}
          onValueChange={setScenario}
          placeholder="Use configured rules"
          emptyOptionLabel="Use configured rules"
          options={endpoint.scenarios.map((s) => ({
            value: s.id,
            label: s.name,
          }))}
        />
      </Field>
      <Field label="Request headers (JSON)">
        <textarea
          className="code"
          rows={3}
          value={headers}
          onChange={(e) => setHeaders(e.target.value)}
        />
      </Field>
      <Field label="Request body">
        <textarea
          className="code"
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>
      {(error || request.error) && (
        <p role="alert" className="error">
          {error || request.error?.message}
        </p>
      )}
      <Button type="submit" disabled={request.isPending}>
        <Play size={14} />
        {request.isPending ? "Waiting for response…" : "Send request"}
      </Button>
      {request.data && (
        <div className="try-result">
          <div>
            <b className={request.data.status >= 400 ? "bad" : "good"}>
              HTTP {request.data.status}
            </b>
            <span>{request.data.elapsedMs} ms</span>
          </div>
          <pre>{pretty(request.data.headers)}</pre>
          <pre data-testid="try-body">
            {request.data.body || "(empty body)"}
          </pre>
        </div>
      )}
    </form>
  );
}
