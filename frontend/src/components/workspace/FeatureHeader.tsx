import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import type { Feature } from "../../api";
import { Button } from "../ui/button";
import type { ModalState } from "./types";

type Props = {
  feature?: Feature;
  busy: boolean;
  onOpenModal: (modal: ModalState) => void;
  onDelete: (feature: Feature) => void;
  onToggleMocking: (enabled: boolean) => void;
  onExport: (feature: Feature) => void;
};

export function FeatureHeader({
  feature,
  busy,
  onOpenModal,
  onDelete,
  onToggleMocking,
  onExport,
}: Props) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">
          <span className="tiny-square" />
          API WORKSPACE
        </div>
        <h1>
          {feature?.name || "Your next API starts here"}
          <span className="heading-dot">.</span>
        </h1>
      </div>
      <div className="heading-actions">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Export feature"
          disabled={!feature}
          onClick={() => feature && onExport(feature)}
        >
          <Download size={15} />
        </Button>
        {feature && (
          <label className="toggle">
            <input
              type="checkbox"
              aria-label="Feature mocking"
              checked={!feature.mockingDisabled}
              disabled={busy}
              onChange={(event) => onToggleMocking(event.target.checked)}
            />
            <span />
            Feature {feature.mockingDisabled ? "paused" : "enabled"}
          </label>
        )}
        {feature && (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Edit feature"
              onClick={() => onOpenModal({ kind: "feature", value: feature })}
            >
              <Pencil size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete feature"
              onClick={() => feature && onDelete(feature)}
            >
              <Trash2 size={16} />
            </Button>
          </>
        )}
        <Button
          disabled={!feature}
          onClick={() => onOpenModal({ kind: "endpoint" })}
        >
          <Plus size={16} />
          New endpoint
        </Button>
      </div>
    </div>
  );
}
