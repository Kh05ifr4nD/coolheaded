const CUE_SCHEMA_NAME = "#FileSpec";
const REGULAR_FILE_NODE = true;
const FILE_SPEC_SCHEMA_FILE_NAME = "fileSpec.cue";

type FileSpecNode = typeof REGULAR_FILE_NODE | FileSpec;

interface FileSpec {
  readonly [name: string]: FileSpecNode;
}

class FileSpecError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FileSpecError";
  }
}

async function commandOutput(
  command: string,
  args: readonly string[],
  cwd?: string,
): Promise<string> {
  const process = new Deno.Command(command, {
    args: [...args],
    ...(typeof cwd === "string" ? { cwd } : {}),
    stderr: "piped",
    stdout: "piped",
  });
  const output = await process.output();

  if (output.success) {
    return new globalThis.TextDecoder().decode(output.stdout);
  }

  const stderr = new globalThis.TextDecoder().decode(output.stderr).trim();
  const detail = stderr.length === 0 ? "" : `: ${stderr}`;
  throw new FileSpecError(`Failed to run ${command}: exit ${output.code}${detail}`);
}

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

function gitPaths(output: string): readonly string[] {
  return output
    .split("\0")
    .filter((path: string): boolean => path.length > 0)
    .toSorted();
}

async function withTemporaryDirectory<Success>(
  useDirectory: (directoryPath: string) => Promise<Success>,
): Promise<Success> {
  const directoryPath = await Deno.makeTempDir({ prefix: "coolheaded-file-spec-" });

  try {
    return await useDirectory(directoryPath);
  } finally {
    await Deno.remove(directoryPath, { recursive: true });
  }
}

async function validateFileSpec(repositoryRoot: string, spec: FileSpec): Promise<void> {
  await withTemporaryDirectory(async (directoryPath: string): Promise<void> => {
    const schemaPath = `${repositoryRoot}/${FILE_SPEC_SCHEMA_FILE_NAME}`;
    const specPath = `${directoryPath}/fileSpec.json`;
    const cueArguments = ["vet", schemaPath, specPath, "-d", CUE_SCHEMA_NAME];

    await Deno.writeTextFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    await commandOutput("cue", cueArguments, repositoryRoot);
  });
}

async function checkedFileSpec(): Promise<void> {
  const repositoryRootOutput = await commandOutput("git", ["rev-parse", "--show-toplevel"]);
  const repositoryRoot = repositoryRootOutput.trim();
  const filesOutput = await commandOutput(
    "git",
    ["ls-files", "--cached", "--full-name", "-z"],
    repositoryRoot,
  );
  const spec = fileSpec(gitPaths(filesOutput));

  await validateFileSpec(repositoryRoot, spec);
}

async function writeError(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const encodedMessage = new globalThis.TextEncoder().encode(`${message}\n`);
  await Deno.stderr.write(encodedMessage);
}

async function main(moduleUrl: string): Promise<void> {
  if (Deno.mainModule !== moduleUrl) {
    return;
  }

  try {
    await checkedFileSpec();
  } catch (error: unknown) {
    await writeError(error);
    Deno.exit(1);
  }
}

void main(import.meta.url);

export { checkedFileSpec };
