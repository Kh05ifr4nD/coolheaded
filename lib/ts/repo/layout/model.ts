import type {
  ConformanceViolation,
  InputDecodeError,
  InternalInvariantError,
  Layout,
  LayoutError,
  LayoutNode,
  SnapshotChangedComponent,
  SnapshotChangedError,
  ToolExecutionError,
} from "coolheaded/repo/layout/types.ts";

const REGULAR_FILE_NODE = true;

const CUE_SCHEMA_NAME = "#Layout";
const LAYOUT_SCHEMA_FILE_NAME = "layout.cue";

function conformanceViolation(message: string): ConformanceViolation {
  return Object.assign(new Error(message), {
    kind: "conformance" as const,
    name: "ConformanceViolation",
  });
}

function toolExecutionError(
  command: string,
  executable: string,
  args: readonly string[],
  exitCode: number | undefined,
  stderr: string,
): ToolExecutionError {
  const detail = stderr.length === 0 ? "" : `: ${stderr}`;
  const status = exitCode === undefined ? "failed to start" : `exit ${exitCode}`;
  return Object.assign(new Error(`Failed to run ${command} (${executable}): ${status}${detail}`), {
    args: [...args],
    command,
    executable,
    exitCode,
    kind: "toolExecution" as const,
    name: "ToolExecutionError",
    stderr,
  });
}

function inputDecodeError(source: string, message: string): InputDecodeError {
  return Object.assign(new Error(`Failed to decode ${source}: ${message}`), {
    kind: "inputDecode" as const,
    name: "InputDecodeError",
    source,
  });
}

function internalInvariantError(message: string): InternalInvariantError {
  return Object.assign(new Error(message), {
    kind: "internalInvariant" as const,
    name: "InternalInvariantError",
  });
}

function snapshotChangedError(
  beforeFingerprint: string,
  afterFingerprint: string,
  changedComponents: readonly SnapshotChangedComponent[],
): SnapshotChangedError {
  return Object.assign(new Error("repository changed while layout was being checked"), {
    afterFingerprint,
    beforeFingerprint,
    changedComponents,
    kind: "snapshotChanged" as const,
    name: "SnapshotChangedError",
  });
}

function isDirectoryNode(node: LayoutNode | undefined): node is Layout {
  return typeof node === "object";
}

function insertGitPath(spec: Layout, path: string): Layout {
  const segments = path.split("/");
  const [segment] = segments;

  if (typeof segment !== "string" || segment.length === 0) {
    throw internalInvariantError(`Invalid git path: ${path}`);
  }

  if (segments.length === 1) {
    const existingNode = spec[segment];
    if (isDirectoryNode(existingNode)) {
      throw internalInvariantError(`Git path conflicts with directory: ${path}`);
    }

    return {
      ...spec,
      [segment]: REGULAR_FILE_NODE,
    };
  }

  const existingNode = spec[segment];
  if (existingNode === REGULAR_FILE_NODE) {
    throw internalInvariantError(`Git path conflicts with file: ${path}`);
  }

  const childTree = isDirectoryNode(existingNode) ? existingNode : {};
  const childPath = segments.slice(1).join("/");

  return {
    ...spec,
    [segment]: insertGitPath(childTree, childPath),
  };
}

function layout(paths: readonly string[]): Layout {
  let spec: Layout = {};

  for (const path of paths) {
    spec = insertGitPath(spec, path);
  }

  return spec;
}

function isErrorRecord(error: unknown): error is Error & Readonly<Record<string, unknown>> {
  return typeof error === "object" && error !== null && error instanceof Error;
}

function isLayoutError(error: unknown): error is LayoutError {
  if (!isErrorRecord(error)) {
    return false;
  }

  const { kind } = error;
  return (
    kind === "conformance" ||
    kind === "inputDecode" ||
    kind === "internalInvariant" ||
    kind === "snapshotChanged" ||
    kind === "toolExecution"
  );
}

function isToolExecutionError(error: unknown): error is ToolExecutionError {
  return isLayoutError(error) && error.kind === "toolExecution";
}

export {
  CUE_SCHEMA_NAME,
  LAYOUT_SCHEMA_FILE_NAME,
  conformanceViolation,
  layout,
  inputDecodeError,
  internalInvariantError,
  isLayoutError,
  isToolExecutionError,
  snapshotChangedError,
  toolExecutionError,
};
