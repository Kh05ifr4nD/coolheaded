import {
  CUE_PATH_SCHEMA_NAME,
  CUE_SCHEMA_NAME,
  FILE_SPEC_SCHEMA_FILE_NAME,
  conformanceViolation,
  fileSpec,
  isConformanceViolation,
  isToolExecutionError,
  snapshotChangedError,
} from "coolheaded/repo/fileSpec/model.ts";
import {
  MAX_CONCURRENT_FILE_SPEC_PROCESSES,
  commandOutput,
  gitIndexEntriesFrom,
  gitPathsFrom,
  ignoredFilePaths,
  ignoredIndexPathDetails,
  mapWithConcurrency,
  repositoryRoot,
  repositorySnapshot,
  validateGitPathNames,
} from "coolheaded/repo/fileSpec/git.ts";
import { join } from "@jsr/std__path";

const CUE_CONFORMANCE_MARKERS = [
  "conflicting values",
  "field is required but not present",
  "field not allowed",
  "incomplete value",
  "invalid value",
  "cannot unify",
] as const;

type GitIndexEntry = Awaited<ReturnType<typeof gitIndexEntriesFrom>>[number];
type RepositoryEnumeration = Parameters<typeof repositorySnapshot>[1];
type CUECommandError = Readonly<{
  readonly command: string;
  readonly exitCode: number | undefined;
  readonly stderr: string;
}>;

type FileSpecEnumeration = RepositoryEnumeration &
  Readonly<{
    readonly indexEntries: readonly GitIndexEntry[];
  }>;

type IgnoredPathResult = Readonly<{
  readonly admitted: boolean;
  readonly path: string;
}>;

function isCueConformanceFailure(error: CUECommandError): boolean {
  return (
    error.command === "cue" &&
    error.exitCode === 1 &&
    error.stderr.includes("fileSpec.json") &&
    CUE_CONFORMANCE_MARKERS.some((marker: string): boolean => error.stderr.includes(marker))
  );
}

async function validateIndexPathsNotIgnored(
  repositoryRootPath: string,
  paths: readonly string[],
): Promise<void> {
  const ignoredPaths = await ignoredIndexPathDetails(repositoryRootPath, paths);

  if (ignoredPaths.length === 0) {
    return;
  }

  throw conformanceViolation(
    [
      "git index contains paths ignored by current ignore rules:",
      ...ignoredPaths.map((path: string): string => `- ${path}`),
    ].join("\n"),
  );
}

async function withTemporaryDirectory<Success>(
  useDirectory: (directoryPath: string) => Promise<Success>,
): Promise<Success> {
  const directoryPath = await Deno.makeTempDir({
    prefix: "coolheaded-file-spec-",
  });

  try {
    return await useDirectory(directoryPath);
  } finally {
    await Deno.remove(directoryPath, { recursive: true });
  }
}

async function validateFileSpec(
  repositoryRootPath: string,
  spec: ReturnType<typeof fileSpec>,
  label: string,
  schemaName: string = CUE_SCHEMA_NAME,
): Promise<void> {
  await withTemporaryDirectory(async (directoryPath: string): Promise<void> => {
    const schemaPath = join(repositoryRootPath, FILE_SPEC_SCHEMA_FILE_NAME);
    const specPath = join(directoryPath, "fileSpec.json");
    const cueArguments = ["vet", schemaPath, specPath, "-d", schemaName];

    await Deno.writeTextFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    try {
      await commandOutput("cue", cueArguments, repositoryRootPath);
    } catch (error: unknown) {
      if (isToolExecutionError(error) && isCueConformanceFailure(error)) {
        throw conformanceViolation(
          `${label} does not conform to ${FILE_SPEC_SCHEMA_FILE_NAME}: ${error.stderr}`,
        );
      }

      throw error;
    }
  });
}

async function validateGitPaths(
  repositoryRootPath: string,
  label: string,
  paths: readonly string[],
): Promise<void> {
  await validateFileSpec(repositoryRootPath, fileSpec(paths), label);
}

async function fileSpecConforms(
  repositoryRootPath: string,
  paths: readonly string[],
  schemaName: string,
): Promise<boolean> {
  try {
    await validateFileSpec(repositoryRootPath, fileSpec(paths), "candidate git paths", schemaName);
    return true;
  } catch (error: unknown) {
    if (isConformanceViolation(error)) {
      return false;
    }

    throw error;
  }
}

async function validateIgnoredPathsNotAdmittedByFileSpec(
  repositoryRootPath: string,
  ignoredPaths: readonly string[],
): Promise<void> {
  const ignoredPathResults = await mapWithConcurrency(
    ignoredPaths,
    MAX_CONCURRENT_FILE_SPEC_PROCESSES,
    async (ignoredPath: string): Promise<IgnoredPathResult> => {
      const conforms = await fileSpecConforms(
        repositoryRootPath,
        [ignoredPath],
        CUE_PATH_SCHEMA_NAME,
      );

      return { admitted: conforms, path: ignoredPath };
    },
  );
  const admittedIgnoredPaths = ignoredPathResults
    .filter((result: IgnoredPathResult): boolean => result.admitted)
    .map((result: IgnoredPathResult): string => result.path);

  if (admittedIgnoredPaths.length === 0) {
    return;
  }

  throw conformanceViolation(
    [
      "current ignore rules hide paths admitted by fileSpec.cue:",
      ...admittedIgnoredPaths.map((path: string): string => `- ${path}`),
      `ignored files checked: ${ignoredPaths.length}; max concurrent CUE checks: ${MAX_CONCURRENT_FILE_SPEC_PROCESSES}`,
    ].join("\n"),
  );
}

async function enumerateRepository(repositoryRootPath: string): Promise<FileSpecEnumeration> {
  const indexEntries = await gitIndexEntriesFrom(repositoryRootPath);
  const indexPaths = indexEntries.map((entry: GitIndexEntry): string => entry.path);
  const visiblePaths = await gitPathsFrom(repositoryRootPath, [
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  const ignoredPaths = await ignoredFilePaths(repositoryRootPath);
  validateGitPathNames([...indexPaths, ...visiblePaths, ...ignoredPaths]);

  return { ignoredPaths, indexEntries, indexPaths, visiblePaths };
}

function snapshotEnumeration(enumeration: FileSpecEnumeration): RepositoryEnumeration {
  return {
    ignoredPaths: enumeration.ignoredPaths,
    indexPaths: enumeration.indexPaths,
    visiblePaths: enumeration.visiblePaths,
  };
}

function snapshotFingerprint(snapshot: RepositorySnapshot): string {
  return JSON.stringify(snapshot);
}

const SNAPSHOT_FIELDS = [
  "enumerationSha256",
  "fileSpecSha256",
  "head",
  "ignoreSourcesSha256",
  "indexTree",
] as const;
const TOOL_COMMANDS = ["cue", "deno", "git"] as const;
const TOOL_IDENTITY_FIELDS = ["executable", "version", "sha256"] as const;
type RepositorySnapshot = Awaited<ReturnType<typeof repositorySnapshot>>;
type SnapshotChangedComponent =
  | Exclude<keyof RepositorySnapshot, "tools">
  | `tools.${keyof RepositorySnapshot["tools"]}.${keyof RepositorySnapshot["tools"]["cue"]}`;
type ToolIdentity = RepositorySnapshot["tools"]["cue"];

function changedSnapshotComponents(
  before: RepositorySnapshot,
  after: RepositorySnapshot,
): readonly SnapshotChangedComponent[] {
  const repositoryComponents = SNAPSHOT_FIELDS.filter(
    (field): boolean => before[field] !== after[field],
  );
  const toolComponents = TOOL_COMMANDS.flatMap((command): readonly SnapshotChangedComponent[] =>
    TOOL_IDENTITY_FIELDS.filter(
      (field: keyof ToolIdentity): boolean =>
        before.tools[command][field] !== after.tools[command][field],
    ).map((field: keyof ToolIdentity): SnapshotChangedComponent => `tools.${command}.${field}`),
  );

  return [...repositoryComponents, ...toolComponents];
}

function assertSnapshotUnchanged(before: RepositorySnapshot, after: RepositorySnapshot): void {
  const beforeFingerprint = snapshotFingerprint(before);
  const afterFingerprint = snapshotFingerprint(after);
  const changedComponents = changedSnapshotComponents(before, after);
  if (changedComponents.length > 0) {
    throw snapshotChangedError(beforeFingerprint, afterFingerprint, changedComponents);
  }
}

function validateGitIndexEntries(entries: readonly GitIndexEntry[]): void {
  const nonRegularEntries = entries.filter(
    (entry: GitIndexEntry): boolean => entry.kind === "symlink" || entry.kind === "gitlink",
  );

  if (nonRegularEntries.length === 0) {
    return;
  }

  throw conformanceViolation(
    [
      "git index contains nodes that are not regular files:",
      ...nonRegularEntries.map(
        (entry: GitIndexEntry): string =>
          `- ${entry.path} (mode ${entry.mode}, kind ${entry.kind})`,
      ),
    ].join("\n"),
  );
}

async function checkFileSpec(repositoryRootPath: string): Promise<void> {
  const initialEnumeration = await enumerateRepository(repositoryRootPath);
  const beforeSnapshot = await repositorySnapshot(
    repositoryRootPath,
    snapshotEnumeration(initialEnumeration),
  );

  validateGitIndexEntries(initialEnumeration.indexEntries);
  await validateGitPaths(repositoryRootPath, "git index", initialEnumeration.indexPaths);
  await validateIndexPathsNotIgnored(repositoryRootPath, initialEnumeration.indexPaths);
  await validateGitPaths(repositoryRootPath, "git visible files", initialEnumeration.visiblePaths);
  await validateIgnoredPathsNotAdmittedByFileSpec(
    repositoryRootPath,
    initialEnumeration.ignoredPaths,
  );

  const afterEnumeration = await enumerateRepository(repositoryRootPath);
  const afterSnapshot = await repositorySnapshot(
    repositoryRootPath,
    snapshotEnumeration(afterEnumeration),
  );
  assertSnapshotUnchanged(beforeSnapshot, afterSnapshot);
}

async function checkedFileSpec(): Promise<void> {
  await checkFileSpec(await repositoryRoot());
}

export { changedSnapshotComponents, checkedFileSpec, checkFileSpec };
