import Editor, { loader } from "@monaco-editor/react";
import { typescript } from "monaco-editor";
import * as monaco from "../../node_modules/monaco-editor/esm/vs/editor/editor.api.js";
import editorWorker from "../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker";
import tsWorker from "../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker";

type Props = {
  value: string;
  onChange: (value: string) => void;
  theme: "light" | "dark";
};

const runtimeTypes = `
type MockmanRequest = {
  method: string;
  path: string;
  scenario: string;
  query: Record<string, string[]>;
  headers: Record<string, string[]>;
  body: any;
};
type MockmanResponseOption = { id: string; name: string; status: number };
type MockmanHttpResponse = {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
  delayMs?: number;
};
type MockmanResult =
  | { responseId: string }
  | { response: MockmanHttpResponse };
interface MockmanMoment {
  format(pattern?: string): string;
  isValid(): boolean;
  isBefore(value?: string | number | Date | MockmanMoment, unit?: string): boolean;
  isAfter(value?: string | number | Date | MockmanMoment, unit?: string): boolean;
  isSame(value?: string | number | Date | MockmanMoment, unit?: string): boolean;
  isBetween(start: string | number | Date | MockmanMoment, end: string | number | Date | MockmanMoment, unit?: string, inclusivity?: string): boolean;
  add(amount: number, unit: string): MockmanMoment;
  subtract(amount: number, unit: string): MockmanMoment;
  diff(value: string | number | Date | MockmanMoment, unit?: string, asFloat?: boolean): number;
  startOf(unit: string): MockmanMoment;
  endOf(unit: string): MockmanMoment;
  utc(): MockmanMoment;
  local(): MockmanMoment;
  toDate(): Date;
  valueOf(): number;
}
interface MockmanMomentFactory {
  (value?: string | number | Date | null | MockmanMoment): MockmanMoment;
  utc(value?: string | number | Date | null): MockmanMoment;
  unix(seconds: number): MockmanMoment;
}
interface MockmanLodash {
  get<T = any>(object: unknown, path: string | number | Array<string | number>, defaultValue?: T): T;
  find<T>(collection: readonly T[], predicate: ((value: T) => unknown) | Partial<T>): T | undefined;
  filter<T>(collection: readonly T[], predicate: ((value: T) => unknown) | Partial<T>): T[];
  map<T, R>(collection: readonly T[], iteratee: (value: T, index: number) => R): R[];
  forEach<T>(collection: readonly T[], iteratee: (value: T, index: number) => unknown): readonly T[];
  sortBy<T>(collection: readonly T[], iteratee?: keyof T | ((value: T) => unknown)): T[];
  groupBy<T>(collection: readonly T[], iteratee: keyof T | ((value: T) => unknown)): Record<string, T[]>;
  keyBy<T>(collection: readonly T[], iteratee: keyof T | ((value: T) => unknown)): Record<string, T>;
  pick<T extends object, K extends keyof T>(object: T, ...keys: K[]): Pick<T, K>;
  omit<T extends object, K extends keyof T>(object: T, ...keys: K[]): Omit<T, K>;
  has(object: unknown, path: string | number | Array<string | number>): boolean;
  includes(collection: unknown, value: unknown): boolean;
  isEmpty(value: unknown): boolean;
  isEqual(value: unknown, other: unknown): boolean;
  toNumber(value: unknown): number;
  trim(value: string): string;
  camelCase(value: string): string;
  startCase(value: string): string;
}
declare const request: MockmanRequest;
declare const responses: MockmanResponseOption[];
declare const attempt: number;
declare const session: string;
declare const environment: string;
declare const input: {
  request: MockmanRequest;
  responses: MockmanResponseOption[];
  attempt: number;
  session: string;
  environment: string;
};
declare const _: MockmanLodash;
declare const moment: MockmanMomentFactory;
`;

loader.config({ monaco: monaco as typeof import("monaco-editor") });

const workerGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (_moduleId: string, label: string) => Worker;
  };
};
workerGlobal.MonacoEnvironment = {
  getWorker: (_moduleId, label) =>
    label === "javascript" || label === "typescript"
      ? new tsWorker()
      : new editorWorker(),
};

let runtimeTypesRegistered = false;

function configureJavaScript() {
  const defaults = typescript.javascriptDefaults;
  defaults.setCompilerOptions({
    allowNonTsExtensions: true,
    checkJs: true,
    lib: ["es2020"],
    noEmit: true,
    strict: true,
    target: typescript.ScriptTarget.ES2020,
  });
  defaults.setDiagnosticsOptions({
    noSyntaxValidation: true,
    noSemanticValidation: false,
  });
  if (!runtimeTypesRegistered) {
    defaults.addExtraLib(runtimeTypes, "file:///mockman/runtime.d.ts");
    runtimeTypesRegistered = true;
  }
}

export function JavaScriptCodeEditor({ value, onChange, theme }: Props) {
  return (
    <div className="javascript-editor">
      <Editor
        height="300px"
        language="javascript"
        theme={theme === "dark" ? "vs-dark" : "vs"}
        value={value}
        beforeMount={configureJavaScript}
        onChange={(nextValue) => onChange(nextValue ?? "")}
        loading={
          <div className="javascript-editor-loading">Loading editor…</div>
        }
        options={{
          ariaLabel: "JavaScript code",
          automaticLayout: true,
          fontFamily: '"SFMono-Regular", Consolas, monospace',
          fontSize: 12,
          minimap: { enabled: false },
          quickSuggestions: true,
          scrollBeyondLastLine: false,
          suggestOnTriggerCharacters: true,
          tabSize: 2,
          wordWrap: "on",
        }}
      />
    </div>
  );
}
