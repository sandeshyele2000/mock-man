import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { Endpoint, Feature, Project, Response, Scenario } from "../../api";
import {
  EntityForm,
  Modal,
  ResponseForm,
  ScenarioForm,
  TryForm,
} from "../editors";
import { Button } from "../ui/button";
import { ResponseViewer } from "./ResponseViewer";
import type { ModalState } from "./types";

type Props = {
  modal: ModalState | null;
  onOpenModal: (modal: ModalState | null) => void;
  project?: Project;
  feature?: Feature;
  endpoint?: Endpoint;
  environment: string;
  theme: "light" | "dark";
  busy: boolean;
  error: string;
  setError: (error: string) => void;
  onSaveEntity: (value: Project | Feature | Endpoint) => void;
  onSaveResponse: (value: Response) => void;
  onSaveScenario: (value: Scenario, responses?: Response[]) => void;
  onDeleteResponse: (value: Response) => void;
  onTryDone: () => void;
  onImportFeature: (file?: File) => Promise<void>;
};

export function WorkspaceDialogs({
  modal,
  onOpenModal,
  project,
  feature,
  endpoint,
  environment,
  theme,
  busy,
  error,
  setError,
  onSaveEntity,
  onSaveResponse,
  onSaveScenario,
  onDeleteResponse,
  onTryDone,
  onImportFeature,
}: Props) {
  const featureImportRef = useRef<HTMLInputElement>(null);
  const [importDragging, setImportDragging] = useState(false);
  async function handleImport(file?: File) {
    try {
      await onImportFeature(file);
    } finally {
      if (featureImportRef.current) featureImportRef.current.value = "";
    }
  }
  if (!modal) return null;
  return (
    <Modal
      title={
        modal.kind === "response-view"
          ? modal.value.name
          : `${modal.kind === "try" ? "Try request" : `${modal.value ? "Edit" : "Create"} ${modal.kind}`}`
      }
      wide={modal.kind === "response-view" || modal.kind === "response"}
      onClose={() => onOpenModal(null)}
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
          onSave={onSaveEntity}
          busy={busy}
        />
      )}{" "}
      {modal.kind === "feature" && !modal.value && (
        <section
          className={`feature-import${importDragging ? " dragging" : ""}`}
          aria-label="Import feature drop zone"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setImportDragging(true);
          }}
          onDragLeave={() => setImportDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setImportDragging(false);
            if (busy) return;
            // Read synchronously while the drop event's file data is accessible.
            const files = Array.from(event.dataTransfer.files);
            if (files.length === 0) {
              for (const item of Array.from(event.dataTransfer.items)) {
                if (item.kind !== "file") continue;
                const file = item.getAsFile();
                if (file) files.push(file);
              }
            }
            if (files.length === 0) {
              setError(
                "No file was received. Drag the JSON file from Finder or File Explorer, or click Import feature to choose it.",
              );
            } else if (files.length > 1) {
              setError("Drop one feature JSON file at a time.");
            } else {
              void handleImport(files[0]);
            }
          }}
        >
          <input
            ref={featureImportRef}
            hidden
            type="file"
            accept="application/json,.json"
            aria-label="Import feature JSON"
            onChange={(event) => void handleImport(event.target.files?.[0])}
          />
          <p>Or import a feature</p>
          <p className="muted">
            Drop a Mockman feature JSON file here, or choose a file.
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => featureImportRef.current?.click()}
          >
            <Upload size={15} />
            Import feature
          </Button>
        </section>
      )}
      {modal.kind === "response-view" && (
        <ResponseViewer
          response={modal.value}
          busy={busy}
          onDelete={onDeleteResponse}
          onEdit={(response) =>
            onOpenModal({ kind: "response", value: response })
          }
        />
      )}
      {modal.kind === "response" && (
        <ResponseForm value={modal.value} onSave={onSaveResponse} busy={busy} />
      )}{" "}
      {modal.kind === "scenario" && endpoint && (
        <ScenarioForm
          value={modal.value}
          responses={endpoint.responses}
          onSave={onSaveScenario}
          busy={busy}
          theme={theme}
        />
      )}{" "}
      {modal.kind === "try" && endpoint && project && feature && (
        <TryForm
          endpoint={endpoint}
          feature={feature.id}
          project={project.id}
          environment={environment}
          onDone={() => onTryDone()}
        />
      )}{" "}
    </Modal>
  );
}
