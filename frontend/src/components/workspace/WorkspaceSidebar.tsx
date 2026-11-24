import {
  ChevronDown,
  ChevronRight,
  Circle,
  Folder,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { Endpoint, Feature, Project } from "../../api";
import type { WorkspaceNavigation } from "../../hooks/useWorkspaceNavigation";
import { MockmanMark } from "../brand";
import { SidebarResizeHandle } from "../SidebarResizeHandle";
import { Button } from "../ui/button";
import { SelectField } from "../ui/select";
import type { ModalState } from "./types";

type Props = {
  projects?: Project[];
  project?: Project;
  selectedFeature?: Feature;
  selectedEndpoint?: Endpoint;
  expandedFeatureID: string;
  setExpandedFeatureID: (id: string) => void;
  setFeatureID: (id: string) => void;
  setEndpointID: (id: string) => void;
  navigation: WorkspaceNavigation;
  onOpenModal: (modal: ModalState) => void;
  onSelectProject: (id: string) => void;
  onDeleteProject: (project: Project) => void;
};

export function WorkspaceSidebar({
  projects,
  project,
  selectedFeature,
  selectedEndpoint,
  expandedFeatureID,
  setExpandedFeatureID,
  setFeatureID,
  setEndpointID,
  navigation,
  onOpenModal,
  onSelectProject,
  onDeleteProject,
}: Props) {
  const {
    compactLayout,
    navigationOpen,
    setNavigationOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarRef,
    setSidebarWidth,
  } = navigation;
  return (
    <>
      {" "}
      {compactLayout && navigationOpen && (
        <button
          className="navigation-backdrop"
          aria-label="Close navigation"
          tabIndex={-1}
          onClick={() => setNavigationOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        id="workspace-navigation"
        aria-label="Workspace navigation"
        role={compactLayout && navigationOpen ? "dialog" : undefined}
        aria-modal={compactLayout && navigationOpen ? true : undefined}
        inert={compactLayout && !navigationOpen}
        className={`sidebar ${!compactLayout && sidebarCollapsed ? "collapsed" : ""} ${navigationOpen ? "navigation-open" : ""}`}
      >
        <div className="sidebar-header">
          <a className="brand" href="./" aria-label="Mockman home">
            <span className="brand-icon">
              <MockmanMark size={23} />
            </span>
            <span className="brand-name">Mockman</span>
          </a>
          <Button
            className="sidebar-toggle"
            variant="ghost"
            size="icon"
            aria-label={
              compactLayout
                ? "Close navigation"
                : sidebarCollapsed
                  ? "Expand sidebar"
                  : "Collapse sidebar"
            }
            onClick={() =>
              compactLayout
                ? setNavigationOpen(false)
                : setSidebarCollapsed(!sidebarCollapsed)
            }
          >
            {compactLayout ? (
              <X size={18} />
            ) : sidebarCollapsed ? (
              <PanelLeftOpen size={16} />
            ) : (
              <PanelLeftClose size={16} />
            )}
          </Button>
        </div>
        {(compactLayout || !sidebarCollapsed) && (
          <>
            <div className="workspace-label">WORKSPACE</div>
            <div className="project-select">
              <Layers size={17} />
              <SelectField
                aria-label="Project"
                value={project?.id || ""}
                onValueChange={onSelectProject}
                options={
                  projects?.map((v) => ({ value: v.id, label: v.name })) || []
                }
                placeholder="No projects yet"
              />
            </div>
            <div className="project-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenModal({ kind: "project" })}
              >
                <Plus size={13} />
                Project
              </Button>
              {project && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit project"
                    onClick={() =>
                      onOpenModal({ kind: "project", value: project })
                    }
                  >
                    <Settings2 size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete project"
                    onClick={() => project && onDeleteProject(project)}
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
                disabled={!project}
                variant="ghost"
                size="icon"
                aria-label="Add feature"
                onClick={() => onOpenModal({ kind: "feature" })}
              >
                <Plus size={15} />
              </Button>
            </div>
            <nav>
              {project?.features.map((feature) => (
                <div key={feature.id}>
                  <button
                    className={`feature-nav ${selectedFeature?.id === feature.id ? "selected" : ""}`}
                    title={feature.name}
                    aria-current={
                      selectedFeature?.id === feature.id ? "page" : undefined
                    }
                    aria-expanded={expandedFeatureID === feature.id}
                    onClick={() => {
                      setFeatureID(feature.id);
                      setExpandedFeatureID(
                        expandedFeatureID === feature.id ? "" : feature.id,
                      );
                      setEndpointID("");
                    }}
                  >
                    <Folder size={16} />
                    <span>{feature.name}</span>
                    <span className="count">{feature.endpoints.length}</span>
                    {expandedFeatureID === feature.id ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </button>
                  <AnimatePresence initial={false}>
                    {expandedFeatureID === feature.id && (
                      <motion.div
                        className="feature-endpoints"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                      >
                        {feature.endpoints.map((endpoint) => (
                          <button
                            key={endpoint.id}
                            className={`endpoint-nav ${selectedEndpoint?.id === endpoint.id ? "current" : ""}`}
                            onClick={() => {
                              setEndpointID(endpoint.id);
                              setNavigationOpen(false);
                            }}
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
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </nav>
          </>
        )}
        {!compactLayout && !sidebarCollapsed && (
          <SidebarResizeHandle onResize={setSidebarWidth} />
        )}
      </aside>
    </>
  );
}
