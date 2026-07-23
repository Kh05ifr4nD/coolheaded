const REGULAR_FILE_NODE = true;

type FileSpecNode = typeof REGULAR_FILE_NODE | FileSpec;

type ConformanceViolation = Error &
  Readonly<{
    readonly kind: "conformance";
  }>;

type ToolExecutionError = Error &
  Readonly<{
    readonly args: readonly string[];
    readonly command: string;
    readonly executable: string;
    readonly exitCode: number | undefined;
    readonly kind: "toolExecution";
    readonly stderr: string;
  }>;

type InputDecodeError = Error &
  Readonly<{
    readonly kind: "inputDecode";
    readonly source: string;
  }>;

type InternalInvariantError = Error &
  Readonly<{
    readonly kind: "internalInvariant";
  }>;

type SnapshotChangedError = Error &
  Readonly<{
    readonly afterFingerprint: string;
    readonly beforeFingerprint: string;
    readonly kind: "snapshotChanged";
  }>;

type FileSpecError =
  | ConformanceViolation
  | InputDecodeError
  | InternalInvariantError
  | SnapshotChangedError
  | ToolExecutionError;

interface FileSpec {
  readonly [name: string]: FileSpecNode;
}

const CUE_SCHEMA_NAME = "#FileSpec";
const CUE_PATH_SCHEMA_NAME = "#FileSpecPath";
const FILE_SPEC_SCHEMA_FILE_NAME = "fileSpec.cue";

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
): SnapshotChangedError {
  return Object.assign(new Error("repository changed while fileSpec was being checked"), {
    afterFingerprint,
    beforeFingerprint,
    kind: "snapshotChanged" as const,
    name: "SnapshotChangedError",
  });
}

function isDirectoryNode(node: FileSpecNode | undefined): node is FileSpec {
  return typeof node === "object";
}

function insertGitPath(spec: FileSpec, path: string): FileSpec {
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

function fileSpec(paths: readonly string[]): FileSpec {
  let spec: FileSpec = {};

  for (const path of paths) {
    spec = insertGitPath(spec, path);
  }

  return spec;
}

function isErrorRecord(error: unknown): error is Error & Readonly<Record<string, unknown>> {
  return typeof error === "object" && error !== null && error instanceof Error;
}

function isFileSpecError(error: unknown): error is FileSpecError {
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

function isConformanceViolation(error: unknown): error is ConformanceViolation {
  return isFileSpecError(error) && error.kind === "conformance";
}

function isToolExecutionError(error: unknown): error is ToolExecutionError {
  return isFileSpecError(error) && error.kind === "toolExecution";
}

export {
  CUE_PATH_SCHEMA_NAME,
  CUE_SCHEMA_NAME,
  FILE_SPEC_SCHEMA_FILE_NAME,
  conformanceViolation,
  fileSpec,
  inputDecodeError,
  internalInvariantError,
  isConformanceViolation,
  isFileSpecError,
  isToolExecutionError,
  snapshotChangedError,
  toolExecutionError,
};
export type {
  ConformanceViolation,
  FileSpec,
  FileSpecError,
  InputDecodeError,
  InternalInvariantError,
  SnapshotChangedError,
  ToolExecutionError,
};
