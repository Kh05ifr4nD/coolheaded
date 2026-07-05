const REGULAR_FILE_NODE = true;

type FileSpecNode = typeof REGULAR_FILE_NODE | FileSpec;

class FileSpecError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FileSpecError";
  }
}

interface FileSpec {
  readonly [name: string]: FileSpecNode;
}

const CUE_SCHEMA_NAME = "#FileSpec";
const FILE_SPEC_SCHEMA_FILE_NAME = "fileSpec.cue";

function isDirectoryNode(node: FileSpecNode | undefined): node is FileSpec {
  return typeof node === "object";
}

function insertGitPath(spec: FileSpec, path: string): FileSpec {
  const segments = path.split("/");
  const [segment] = segments;

  if (typeof segment !== "string" || segment.length === 0) {
    throw new FileSpecError(`Invalid git path: ${path}`);
  }

  if (segments.length === 1) {
    const existingNode = spec[segment];
    if (isDirectoryNode(existingNode)) {
      throw new FileSpecError(`Git path conflicts with directory: ${path}`);
    }

    return {
      ...spec,
      [segment]: REGULAR_FILE_NODE,
    };
  }

  const existingNode = spec[segment];
  if (existingNode === REGULAR_FILE_NODE) {
    throw new FileSpecError(`Git path conflicts with file: ${path}`);
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

function fileSpecError(message: string): Error {
  return new FileSpecError(message);
}

function isFileSpecError(error: unknown): boolean {
  return error instanceof FileSpecError;
}

export { CUE_SCHEMA_NAME, FILE_SPEC_SCHEMA_FILE_NAME, fileSpec, fileSpecError, isFileSpecError };
export type { FileSpec };
