// Created by Sandesh
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Play, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, type CSSProperties } from "react";
import {
  api,
  loadConfig,
  type Config,
  type Endpoint,
  type Feature,
  type Log,
  type Project,
  type Response,
  type Scenario,
} from "./api";
import { MockmanMark } from "./components/brand";
import { Button } from "./components/ui/button";
import { ConnectTab } from "./components/workspace/ConnectTab";
import { EndpointDetail } from "./components/workspace/EndpointDetail";
import { EndpointList } from "./components/workspace/EndpointList";
import { FeatureHeader } from "./components/workspace/FeatureHeader";
import { FeatureOverview } from "./components/workspace/FeatureOverview";
import { RequestLogsTab } from "./components/workspace/RequestLogsTab";
import { ResponsesTab } from "./components/workspace/ResponsesTab";
import { ScenariosTab } from "./components/workspace/ScenariosTab";
import type { ModalState, WorkspaceTab } from "./components/workspace/types";
import { WorkspaceDialogs } from "./components/workspace/WorkspaceDialogs";
import { WorkspaceHeader } from "./components/workspace/WorkspaceHeader";
import { WorkspaceSidebar } from "./components/workspace/WorkspaceSidebar";
import { MOCK_SERVER_URL } from "./config";
import { useTheme } from "./hooks/useTheme";
import { useWorkspaceNavigation } from "./hooks/useWorkspaceNavigation";
import {
  exportFeature,
  exportScenario,
  readFeatureImport,
  readScenarioImport,
} from "./workspaceTransfers";
import {
  planWorkspaceChange,
  mergeMetadataDraft,
  applyWorkspaceChange,
  type WorkspaceChangeResult,
} from "./workspaceChanges";
export default function App() {
  const client = useQueryClient();
  const config = useQuery({ queryKey: ["config"], queryFn: loadConfig });
  const limits = useQuery({
    queryKey: ["limits"],
    queryFn: () => api<{ importBytes: number }>("/api/limits"),
    staleTime: Infinity,
  });
  const [projectID, setProjectID] = useState("demo");
  const [featureID, setFeatureID] = useState("");
  const [expandedFeatureID, setExpandedFeatureID] = useState("");
  const [endpointID, setEndpointID] = useState("");
  const [environment, setEnvironment] = useState("development");
  const navigation = useWorkspaceNavigation();
  const { compactLayout, navigationOpen, sidebarWidth } = navigation;
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<WorkspaceTab>("responses");
  const [search, setSearch] = useState("");
  const [responseSearch, setResponseSearch] = useState("");
  const [scenarioSearch, setScenarioSearch] = useState("");
  const [modal, setModal] = useState<ModalState | null>(null);
  const [notice, setNotice] = useState("");
  const [canCopy, setCanCopy] = useState(
    () =>
      window.isSecureContext &&
      typeof navigator.clipboard?.writeText === "function",
  );
  const [error, setError] = useState("");
  const workspaceConfig = config.data;
  const selectedProject =
    workspaceConfig?.projects.find((p) => p.id === projectID) ||
    workspaceConfig?.projects[0];
  const selectedFeature =
    selectedProject?.features.find((f) => f.id === featureID) ||
    selectedProject?.features[0];
  const selectedEndpoint =
    selectedFeature?.endpoints.find((e) => e.id === endpointID) ||
    selectedFeature?.endpoints[0];
  const mockingPaused = !!selectedFeature?.mockingDisabled;
  const activeEnvironment = selectedProject?.environments.includes(environment)
    ? environment
    : selectedProject?.environments[0] || "development";
  const logs = useQuery({
    queryKey: ["logs", selectedProject?.id, activeEnvironment],
    queryFn: () =>
      api<Log[]>(
        `/api/logs?project=${encodeURIComponent(selectedProject!.id)}&environment=${encodeURIComponent(activeEnvironment)}`,
      ),
    enabled: !!selectedProject,
  });
  const save = useMutation({
    mutationFn: async (next: Config) => {
      if (!workspaceConfig) throw new Error("Workspace has not loaded.");
      const plan = planWorkspaceChange(workspaceConfig, next);
      if (!plan) return null;
      const saved = await api<WorkspaceChangeResult>(
        plan.path,
        plan.method,
        plan.body,
      );
      return {
        id: plan.projectID,
        project: applyWorkspaceChange(plan, saved),
        version: saved.workspaceVersion,
        stale: saved.stale,
      };
    },
    onSuccess: (data) => {
      if (data)
        client.setQueryData<Config>(["config"], (current) => {
          if (!current) return current;
          const projects = current.projects.filter(
            (project) => project.id !== data.id,
          );
          if (data.project) {
            const index = current.projects.findIndex(
              (project) => project.id === data.id,
            );
            projects.splice(
              index < 0 ? projects.length : index,
              0,
              data.project,
            );
          }
          return {
            ...current,
            version: Math.max(current.version, data.version),
            projects,
          };
        });
      if (data?.stale) void client.invalidateQueries({ queryKey: ["config"] });
      setModal(null);
      setError("");
      setNotice("Workspace saved");
    },
    onError: (err) => {
      setError(err.message);
      // Keep the editor open, but refresh version tokens after a concurrent edit.
      void client.invalidateQueries({ queryKey: ["config"] });
    },
  });
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 3500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  function change(
    update: (
      next: Config,
      project: Project,
      feature: Feature | undefined,
      endpoint: Endpoint | undefined,
    ) => void,
  ) {
    if (!workspaceConfig || !selectedProject || save.isPending) return;
    const np = structuredClone(selectedProject);
    const next = {
      ...workspaceConfig,
      projects: workspaceConfig.projects.map((project) =>
        project.id === np.id ? np : project,
      ),
    };
    const nf = np.features.find((v) => v.id === selectedFeature?.id);
    const ne = nf?.endpoints.find((v) => v.id === selectedEndpoint?.id);
    update(next, np, nf, ne);
    save.mutate(next);
  }
  function remove(
    kind: string,
    name: string,
    update: Parameters<typeof change>[0],
  ) {
    if (
      window.confirm(
        `Delete ${kind} “${name}”? This also removes its nested configuration.`,
      )
    )
      change(update);
  }

  function selectProject(id: string) {
    setProjectID(id);
    setFeatureID("");
    setExpandedFeatureID("");
    setEndpointID("");
  }
  function deleteProject(project: Project) {
    remove("project", project.name, (next) => {
      next.projects = next.projects.filter((value) => value.id !== project.id);
    });
  }
  function deleteFeature(feature: Feature) {
    remove("feature", feature.name, (_, project) => {
      project.features = project.features.filter(
        (value) => value.id !== feature.id,
      );
    });
  }
  function deleteEndpoint(endpoint: Endpoint) {
    remove("endpoint", endpoint.name, (_, __, feature) => {
      feature!.endpoints = feature!.endpoints.filter(
        (value) => value.id !== endpoint.id,
      );
    });
  }
  function deleteResponse(response: Response) {
    remove("response", response.name, (_, __, ___, endpoint) => {
      endpoint!.responses = endpoint!.responses.filter(
        (value) => value.id !== response.id,
      );
    });
  }
  function deleteScenario(scenario: Scenario) {
    remove("scenario", scenario.name, (_, __, ___, endpoint) => {
      endpoint!.scenarios = endpoint!.scenarios.filter(
        (value) => value.id !== scenario.id,
      );
      for (const environment of Object.keys(endpoint!.active)) {
        if (endpoint!.active[environment] === scenario.id)
          delete endpoint!.active[environment];
      }
    });
  }
  function activateScenario(scenario: Scenario) {
    change((_, __, ___, endpoint) => {
      endpoint!.active[activeEnvironment] = scenario.id;
    });
  }
  function toggleFeatureMocking(enabled: boolean) {
    change((_, __, feature) => {
      if (feature) feature.mockingDisabled = !enabled;
    });
  }
  function toggleEndpointMocking(enabled: boolean) {
    change((_, __, ___, endpoint) => {
      endpoint!.enabled = enabled;
    });
  }

  function saveEntity(value: Project | Feature | Endpoint) {
    if (save.isPending || !workspaceConfig) return;
    try {
      if (modal?.kind === "project") {
        const next = {
          ...workspaceConfig,
          projects: [...workspaceConfig.projects],
        };
        const index = next.projects.findIndex(
          (project) => project.id === value.id,
        );
        const prepared = mergeMetadataDraft(
          next.projects[index],
          value as Project,
          modal.value,
        );
        if (index < 0) next.projects.push(prepared);
        else next.projects[index] = prepared;
        save.mutate(next);
        setProjectID(value.id);
      } else if (modal?.kind === "feature") {
        const prepared = mergeMetadataDraft(
          selectedProject?.features.find((feature) => feature.id === value.id),
          value as Feature,
          modal.value,
        );
        change((_, project) => {
          const index = project.features.findIndex(
            (feature) => feature.id === value.id,
          );
          if (index < 0) project.features.push(prepared);
          else project.features[index] = prepared;
          setFeatureID(value.id);
          setExpandedFeatureID(value.id);
        });
      } else if (modal?.kind === "endpoint") {
        const prepared = mergeMetadataDraft(
          selectedFeature?.endpoints.find(
            (endpoint) => endpoint.id === value.id,
          ),
          value as Endpoint,
          modal.value,
        );
        change((_, __, feature) => {
          if (!feature) return;
          const index = feature.endpoints.findIndex(
            (endpoint) => endpoint.id === value.id,
          );
          if (index < 0) feature.endpoints.push(prepared);
          else feature.endpoints[index] = prepared;
          setEndpointID(value.id);
        });
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save this item.",
      );
    }
  }
  function saveResponse(v: Response) {
    if (
      modal?.kind === "response" &&
      modal.value &&
      selectedEndpoint?.responses.find((response) => response.id === v.id)
        ?.version !== modal.value.version
    ) {
      setError(
        "This response changed while the editor was open. Close and reopen the editor before saving.",
      );
      return;
    }
    change((_, __, ___, e) => {
      if (!e) return;
      const i = e.responses.findIndex((r) => r.id === v.id);
      if (i < 0) e.responses.push(v);
      else e.responses[i] = v;
    });
  }
  function saveScenario(v: Scenario, importedResponses: Response[] = []) {
    if (
      modal?.kind === "scenario" &&
      modal.value &&
      selectedEndpoint?.scenarios.find((scenario) => scenario.id === v.id)
        ?.version !== modal.value.version
    ) {
      setError(
        "This scenario changed while the editor was open. Close and reopen the editor before saving.",
      );
      return;
    }
    change((_, __, ___, e) => {
      if (!e) return;
      const importedIDs = new Set(
        importedResponses.map((response) => response.id),
      );
      e.responses = [
        ...e.responses.filter((response) => !importedIDs.has(response.id)),
        ...importedResponses,
      ];
      const i = e.scenarios.findIndex((s) => s.id === v.id);
      if (i < 0) e.scenarios.push(v);
      else e.scenarios[i] = v;
      if (!e.active[activeEnvironment]) e.active[activeEnvironment] = v.id;
    });
  }

  async function importFeature(file?: File) {
    if (!file || !selectedProject || save.isPending) return;
    try {
      const importedFeature = await readFeatureImport(
        file,
        selectedProject.environments,
        limits.data?.importBytes,
      );
      change((_, project) => {
        project.features.push(importedFeature);
      });
      setFeatureID(importedFeature.id);
      setExpandedFeatureID(importedFeature.id);
      setEndpointID("");
      setNotice(`Imported feature “${importedFeature.name}”.`);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not import this feature.",
      );
    }
  }
  async function importScenario(file?: File) {
    if (!file || !selectedEndpoint) return;
    try {
      const { scenario: importedScenario, responses: importedResponses } =
        await readScenarioImport(file, limits.data?.importBytes);
      change((_, __, ___, endpoint) => {
        if (!endpoint) return;
        endpoint.responses.push(...importedResponses);
        endpoint.scenarios.push(importedScenario);
        if (!endpoint.active[activeEnvironment])
          endpoint.active[activeEnvironment] = importedScenario.id;
      });
      setNotice(`Imported scenario “${importedScenario.name}”.`);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not import this scenario.",
      );
    }
  }
  const active = selectedEndpoint?.scenarios.find(
    (s) => s.id === selectedEndpoint.active[activeEnvironment],
  );
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const curl =
    selectedEndpoint && selectedProject && selectedFeature
      ? [
          `curl -i -X ${selectedEndpoint.method} ${quote(`${MOCK_SERVER_URL.replace(/\/$/, "")}${encodeURI(selectedEndpoint.path)}`)}`,
          `  -H ${quote(`X-Mock-Project: ${selectedProject.id}`)}`,
          `  -H ${quote(`X-Mock-Feature: ${selectedFeature.id}`)}`,
          `  -H ${quote(`X-Mock-Environment: ${activeEnvironment}`)}`,
        ].join(" \\\n")
      : "";
  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(curl);
      setNotice("curl copied");
    } catch {
      setCanCopy(false);
    }
  }
  if (config.isPending)
    return (
      <div className="boot">
        <MockmanMark size={32} />
        <h2>Opening your workspace…</h2>
      </div>
    );
  if (config.isError)
    return (
      <div className="boot">
        <h2>Could not load Mockman</h2>
        <p>{config.error.message}</p>
        <Button onClick={() => void config.refetch()}>Try again</Button>
      </div>
    );
  return (
    <div
      className="app"
      data-theme={theme}
      style={
        {
          "--sidebar-width":
            sidebarWidth === null
              ? undefined
              : `clamp(244px, ${sidebarWidth}px, min(560px, 50vw))`,
        } as CSSProperties
      }
    >
      <WorkspaceSidebar
        projects={workspaceConfig?.projects}
        project={selectedProject}
        selectedFeature={selectedFeature}
        selectedEndpoint={selectedEndpoint}
        expandedFeatureID={expandedFeatureID}
        setExpandedFeatureID={setExpandedFeatureID}
        setFeatureID={setFeatureID}
        setEndpointID={setEndpointID}
        navigation={navigation}
        onOpenModal={setModal}
        onSelectProject={selectProject}
        onDeleteProject={deleteProject}
      />
      <div className="workspace" inert={compactLayout && navigationOpen}>
        <WorkspaceHeader
          project={selectedProject}
          feature={selectedFeature}
          environment={activeEnvironment}
          onEnvironmentChange={setEnvironment}
          theme={theme}
          onThemeChange={setTheme}
          navigation={navigation}
        />
        <main>
          <FeatureHeader
            feature={selectedFeature}
            busy={save.isPending}
            onOpenModal={setModal}
            onDelete={deleteFeature}
            onToggleMocking={toggleFeatureMocking}
            onExport={exportFeature}
          />
          <div
            className="workspace-content"
            role="region"
            aria-label="Feature content"
            tabIndex={0}
          >
            {error && (
              <div role="alert" className="error banner">
                {error}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setError("");
                    void config.refetch();
                  }}
                >
                  Reload workspace
                </Button>
                <button aria-label="Dismiss error" onClick={() => setError("")}>
                  <X size={16} />
                </button>
              </div>
            )}
            {mockingPaused && (
              <div className="mocking-pause-banner" role="status">
                <div>
                  <b>Feature mocking is paused</b>
                  <p>
                    Requests return 404. Your endpoint settings and scenario
                    progress are preserved.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={save.isPending}
                  onClick={() => {
                    change((_, __, feature) => {
                      if (feature) feature.mockingDisabled = false;
                    });
                  }}
                >
                  <Play size={14} />
                  Resume mocking
                </Button>
              </div>
            )}
            <FeatureOverview
              feature={selectedFeature}
              mockingPaused={mockingPaused}
              requestCount={logs.data?.length || 0}
              environment={activeEnvironment}
            />
            <motion.div
              key={selectedEndpoint?.id || "empty-workspace"}
              className="content-grid"
              initial={{ opacity: 0, y: 7 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <EndpointList
                feature={selectedFeature}
                endpoint={selectedEndpoint}
                mockingPaused={mockingPaused}
                search={search}
                onSearchChange={setSearch}
                onSelect={setEndpointID}
              />
              <EndpointDetail
                endpoint={selectedEndpoint}
                project={selectedProject}
                feature={selectedFeature}
                environment={activeEnvironment}
                active={active}
                mockingPaused={mockingPaused}
                busy={save.isPending}
                tab={tab}
                onTabChange={setTab}
                requestCount={
                  logs.data?.filter(
                    (log) => log.detail.endpoint === selectedEndpoint?.id,
                  ).length || 0
                }
                onOpenModal={setModal}
                onDelete={deleteEndpoint}
                onToggleMocking={toggleEndpointMocking}
              >
                {selectedEndpoint && tab === "responses" && (
                  <ResponsesTab
                    endpoint={selectedEndpoint}
                    search={responseSearch}
                    onSearchChange={setResponseSearch}
                    onOpenModal={setModal}
                    onDelete={deleteResponse}
                  />
                )}
                {selectedEndpoint && tab === "scenarios" && (
                  <ScenariosTab
                    endpoint={selectedEndpoint}
                    active={active}
                    env={activeEnvironment}
                    logs={logs.data ?? []}
                    busy={save.isPending}
                    search={scenarioSearch}
                    onSearchChange={setScenarioSearch}
                    onOpenModal={setModal}
                    onDelete={deleteScenario}
                    onActivate={activateScenario}
                    onImport={importScenario}
                    onExport={(scenario) =>
                      exportScenario(scenario, selectedEndpoint.responses)
                    }
                  />
                )}
                {selectedEndpoint && tab === "logs" && (
                  <RequestLogsTab
                    endpoint={selectedEndpoint}
                    logs={logs.data}
                    pending={logs.isPending}
                    error={logs.error}
                    onRefresh={() => void logs.refetch()}
                  />
                )}
                {selectedEndpoint && tab === "connect" && (
                  <ConnectTab curl={curl} canCopy={canCopy} onCopy={copyCurl} />
                )}
              </EndpointDetail>
            </motion.div>
          </div>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      <WorkspaceDialogs
        modal={modal}
        onOpenModal={setModal}
        project={selectedProject}
        feature={selectedFeature}
        endpoint={selectedEndpoint}
        environment={activeEnvironment}
        theme={theme}
        busy={save.isPending}
        error={error}
        setError={setError}
        onSaveEntity={saveEntity}
        onSaveResponse={saveResponse}
        onSaveScenario={saveScenario}
        onDeleteResponse={deleteResponse}
        onTryDone={() => void logs.refetch()}
        onImportFeature={importFeature}
      />
    </div>
  );
}
