import {
  CUE_SCHEMA_NAME,
  LAYOUT_SCHEMA_FILE_NAME,
  conformanceViolation,
  isToolExecutionError,
  layout,
  snapshotChangedError,
} from "coolheaded/repo/layout/model.ts";
import type {
  RepositorySnapshot,
  SnapshotChangedComponent,
  ToolExecutionError,
  ToolIdentity,
} from "coolheaded/repo/layout/types.ts";
import {
  gitIndexEntriesFrom,
  gitPathsFrom,
  repositoryRoot,
  repositorySnapshot,
  validateGitPathNames,
} from "coolheaded/repo/layout/git.ts";
import { commandOutput } from "coolheaded/repo/layout/command.ts";
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

type LayoutEnumeration = RepositoryEnumeration &
  Readonly<{
    readonly indexEntries: readonly GitIndexEntry[];
  }>;

function isCueConformanceFailure(error: Readonly<ToolExecutionError>): boolean {
  return (
    error.command === "cue" &&
    error.exitCode === 1 &&
    error.stderr.includes("layout.json") &&
    CUE_CONFORMANCE_MARKERS.some((marker: string): boolean => error.stderr.includes(marker))
  );
}

async function withTemporaryDirectory<Success>(
  useDirectory: (directoryPath: string) => Promise<Success>,
): Promise<Success> {
  const directoryPath = await Deno.makeTempDir({
    prefix: "coolheaded-layout-",
  });

  try {
    return await useDirectory(directoryPath);
  } finally {
    await Deno.remove(directoryPath, { recursive: true });
  }
}

async function validateLayout(
  repositoryRootPath: string,
  spec: ReturnType<typeof layout>,
  label: string,
  schemaName: string = CUE_SCHEMA_NAME,
): Promise<void> {
  await withTemporaryDirectory(async (directoryPath: string): Promise<void> => {
    const schemaPath = join(repositoryRootPath, LAYOUT_SCHEMA_FILE_NAME);
    const specPath = join(directoryPath, "layout.json");
    const cueArguments = ["vet", schemaPath, specPath, "-d", schemaName];

    await Deno.writeTextFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    try {
      await commandOutput("cue", cueArguments, repositoryRootPath);
    } catch (error: unknown) {
      if (isToolExecutionError(error) && isCueConformanceFailure(error)) {
        throw conformanceViolation(
          `${label} does not conform to ${LAYOUT_SCHEMA_FILE_NAME}: ${error.stderr}`,
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
  await validateLayout(repositoryRootPath, layout(paths), label);
}

async function enumerateRepository(repositoryRootPath: string): Promise<LayoutEnumeration> {
  const indexEntries = await gitIndexEntriesFrom(repositoryRootPath);
  const indexPaths = indexEntries.map((entry: GitIndexEntry): string => entry.path);
  const visiblePaths = await gitPathsFrom(repositoryRootPath, [
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  validateGitPathNames([...indexPaths, ...visiblePaths]);

  return { indexEntries, indexPaths, visiblePaths };
}

function snapshotEnumeration(enumeration: LayoutEnumeration): RepositoryEnumeration {
  return {
    indexPaths: enumeration.indexPaths,
    visiblePaths: enumeration.visiblePaths,
  };
}

function snapshotFingerprint(snapshot: RepositorySnapshot): string {
  return JSON.stringify(snapshot);
}

const SNAPSHOT_FIELDS = ["enumerationSha256", "layoutSha256", "head", "indexTree"] as const;
const TOOL_COMMANDS = ["cue", "deno", "git"] as const;
const TOOL_IDENTITY_FIELDS = ["executable", "version", "sha256"] as const;

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

async function checkLayout(repositoryRootPath: string): Promise<void> {
  const initialEnumeration = await enumerateRepository(repositoryRootPath);
  const beforeSnapshot = await repositorySnapshot(
    repositoryRootPath,
    snapshotEnumeration(initialEnumeration),
  );

  validateGitIndexEntries(initialEnumeration.indexEntries);
  await validateGitPaths(repositoryRootPath, "git index", initialEnumeration.indexPaths);
  await validateGitPaths(repositoryRootPath, "git visible files", initialEnumeration.visiblePaths);

  const afterEnumeration = await enumerateRepository(repositoryRootPath);
  const afterSnapshot = await repositorySnapshot(
    repositoryRootPath,
    snapshotEnumeration(afterEnumeration),
  );
  assertSnapshotUnchanged(beforeSnapshot, afterSnapshot);
}

async function checkedLayout(): Promise<void> {
  await checkLayout(await repositoryRoot());
}

export { changedSnapshotComponents, checkedLayout, checkLayout };
