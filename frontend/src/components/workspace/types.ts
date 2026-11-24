import type { Endpoint, Feature, Project, Response, Scenario } from "../../api";
export type ModalState =
  | { kind: "project"; value?: Project }
  | { kind: "feature"; value?: Feature }
  | { kind: "endpoint"; value?: Endpoint }
  | { kind: "response"; value?: Response }
  | { kind: "response-view"; value: Response }
  | { kind: "scenario"; value?: Scenario }
  | { kind: "try" };

export type WorkspaceTab = "responses" | "scenarios" | "logs" | "connect";
