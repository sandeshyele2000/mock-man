import { ChevronRight, Moon, PanelLeftOpen, Sun } from "lucide-react";
import type { Feature, Project } from "../../api";
import type { WorkspaceNavigation } from "../../hooks/useWorkspaceNavigation";
import { Button } from "../ui/button";
import { SelectField } from "../ui/select";

type Props = {
  project?: Project;
  feature?: Feature;
  environment: string;
  onEnvironmentChange: (value: string) => void;
  theme: "light" | "dark";
  onThemeChange: (value: "light" | "dark") => void;
  navigation: WorkspaceNavigation;
};

export function WorkspaceHeader({
  project,
  feature,
  environment,
  onEnvironmentChange,
  theme,
  onThemeChange,
  navigation,
}: Props) {
  const { navigationToggleRef, navigationOpen, setNavigationOpen } = navigation;
  return (
    <header className="topbar">
      <Button
        className="mobile-sidebar-toggle"
        ref={navigationToggleRef}
        variant="ghost"
        size="icon"
        aria-label="Open navigation"
        aria-expanded={navigationOpen}
        aria-controls="workspace-navigation"
        onClick={() => setNavigationOpen(true)}
      >
        <PanelLeftOpen size={16} />
      </Button>
      <div className="breadcrumb">
        <span>Workspace</span>
        <ChevronRight size={13} />
        <span>{project?.name || "Get started"}</span>
        <ChevronRight size={13} />
        <b>{feature?.name || "Features"}</b>
      </div>
      <div className="top-context">
        <SelectField
          aria-label="Environment"
          value={environment}
          onValueChange={onEnvironmentChange}
          options={
            project?.environments.map((v) => ({ value: v, label: v })) || []
          }
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </Button>
      </div>
    </header>
  );
}
