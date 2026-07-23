import {
  conformanceViolation,
  inputDecodeError,
  internalInvariantError,
  isFileSpecError,
  toolExecutionError,
} from "coolheaded/repo/fileSpec/model.ts";
import { join } from "@jsr/std__path";

const FILE_SPEC_COMMANDS = {
  cue: { environmentVariable: "COOLHEADED_CUE", versionArguments: ["version"] },
  git: { environmentVariable: "COOLHEADED_GIT", versionArguments: ["--version"] },
} as const;

const MAX_CONCURRENT_FILE_SPEC_PROCESSES = 8;

type FileSpecCommand = keyof typeof FILE_SPEC_COMMANDS;

type CommandEnvironment = Readonly<{
  clearEnv?: boolean;
  env?: Readonly<Record<string, string>>;
}>;

type GitNodeKind = "file" | "executable" | "symlink" | "gitlink";

type GitIndexEntry = Readonly<{
  readonly kind: GitNodeKind;
  readonly mode: string;
  readonly path: string;
  readonly stage: number;
}>;

type RepositoryEnumeration = Readonly<{
  readonly ignoredPaths: readonly string[];
  readonly indexPaths: readonly string[];
  readonly visiblePaths: readonly string[];
}>;

type ToolIdentity = Readonly<{
  readonly command: FileSpecCommand;
  readonly executable: string;
  readonly sha256: string;
  readonly version: string;
}>;

type RepositorySnapshot = Readonly<{
  readonly enumerationSha256: string;
  readonly fileSpecSha256: string;
  readonly head: string;
  readonly ignoreSourcesSha256: string;
  readonly indexTree: string;
  readonly tools: readonly ToolIdentity[];
}>;

const GIT_MODES = {
  "100644": "file",
  "100755": "executable",
  "120000": "symlink",
  "160000": "gitlink",
} as const satisfies Readonly<Record<string, GitNodeKind>>;

function gitNodeKind(mode: string): GitNodeKind | undefined {
  for (const [knownMode, kind] of Object.entries(GIT_MODES)) {
    if (knownMode === mode) {
      return kind;
    }
  }

  return undefined;
}

function commandEnvironmentVariable(command: FileSpecCommand): string {
  return FILE_SPEC_COMMANDS[command].environmentVariable;
}

function resolveToolExecutable(command: FileSpecCommand): string {
  const environmentVariable = commandEnvironmentVariable(command);
  const executable = Deno.env.get(environmentVariable);

  if (typeof executable !== "string" || executable.length === 0) {
    throw internalInvariantError(
      `${environmentVariable} must contain an absolute ${command} executable path`,
    );
  }

  if (!executable.startsWith("/")) {
    throw internalInvariantError(
      `${environmentVariable} must contain an absolute ${command} executable path: ${executable}`,
    );
  }

  return executable;
}

function isolatedCommandEnvironment(): CommandEnvironment {
  return {
    clearEnv: true,
    env: { PATH: Deno.env.get("PATH") ?? "" },
  };
}

async function executeCommand(
  command: FileSpecCommand,
  args: readonly string[],
  cwd: string | undefined,
  input?: string,
): Promise<Readonly<{ executable: string; output: Deno.CommandOutput }>> {
  const executable = resolveToolExecutable(command);

  try {
    const process = new Deno.Command(executable, {
      args: [...args],
      ...isolatedCommandEnvironment(),
      ...(typeof cwd === "string" ? { cwd } : {}),
      stderr: "piped",
      stdin: input === undefined ? "null" : "piped",
      stdout: "piped",
    }).spawn();

    if (input !== undefined) {
      const writer = process.stdin.getWriter();
      await writer.write(new globalThis.TextEncoder().encode(input));
      await writer.close();
    }

    return { executable, output: await process.output() };
  } catch (error: unknown) {
    if (isFileSpecError(error)) {
      throw error;
    }

    const detail = error instanceof Error ? error.message : String(error);
    throw toolExecutionError(command, executable, args, undefined, detail);
  }
}

function decodeUtf8(bytes: readonly number[], source: string): string {
  try {
    const view = Uint8Array.from(bytes);
    return new globalThis.TextDecoder("utf8", { fatal: true }).decode(view);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw inputDecodeError(source, detail);
  }
}

async function commandOutputWithInput(
  command: FileSpecCommand,
  args: readonly string[],
  input: string,
  cwd: string,
  successCodes: readonly number[] = [0],
): Promise<string> {
  const { executable, output } = await executeCommand(command, args, cwd, input);

  if (successCodes.includes(output.code)) {
    return decodeUtf8([...output.stdout], `${command} stdout`);
  }

  const stderr = decodeUtf8([...output.stderr], `${command} stderr`).trim();
  throw toolExecutionError(command, executable, args, output.code, stderr);
}

async function commandOutput(
  command: FileSpecCommand,
  args: readonly string[],
  cwd?: string,
  successCodes: readonly number[] = [0],
): Promise<string> {
  const { executable, output } = await executeCommand(command, args, cwd);

  if (successCodes.includes(output.code)) {
    return decodeUtf8([...output.stdout], `${command} stdout`);
  }

  const stderr = decodeUtf8([...output.stderr], `${command} stderr`).trim();
  throw toolExecutionError(command, executable, args, output.code, stderr);
}

function caseFoldKey(path: string): string {
  return path.normalize("NFC").toLocaleLowerCase("en-US");
}

function validateGitPathNames(paths: readonly string[]): void {
  const seenPaths = new Map<string, string>();

  for (const path of paths) {
    const normalizedPath = path.normalize("NFC");
    if (normalizedPath !== path) {
      throw inputDecodeError("Git pathname", `path is not NFC-normalized: ${path}`);
    }

    const foldedPath = caseFoldKey(path);
    const existingPath = seenPaths.get(foldedPath);
    if (existingPath !== undefined && existingPath !== path) {
      throw inputDecodeError(
        "Git pathname",
        `case-fold collision between ${existingPath} and ${path}`,
      );
    }

    seenPaths.set(foldedPath, path);
  }
}

function gitPaths(output: string): readonly string[] {
  const paths = output
    .split("\0")
    .filter((path: string): boolean => path.length > 0)
    .toSorted();
  validateGitPathNames(paths);
  return paths;
}

function ignoredByPositivePattern(pattern: string): boolean {
  return pattern.length > 0 && !pattern.startsWith("!");
}

function parseGitIndexEntry(record: string): GitIndexEntry {
  const separatorIndex = record.indexOf("\t");
  if (separatorIndex === -1) {
    throw internalInvariantError(`Malformed git ls-files --stage record: ${record}`);
  }

  const metadata = record.slice(0, separatorIndex).split(" ");
  const [mode, objectId, stageText] = metadata;
  const path = record.slice(separatorIndex + 1);

  if (
    typeof mode !== "string" ||
    typeof objectId !== "string" ||
    typeof stageText !== "string" ||
    mode.length === 0 ||
    objectId.length === 0 ||
    !/^[0-3]$/u.test(stageText)
  ) {
    throw internalInvariantError(`Malformed git ls-files --stage record: ${record}`);
  }

  const kind = gitNodeKind(mode);
  if (kind === undefined) {
    throw internalInvariantError(`Unsupported git index mode ${mode} for ${path}`);
  }

  const stage = Number(stageText);
  if (stage !== 0) {
    throw conformanceViolation(`git index contains unresolved stage ${stage} for path ${path}`);
  }

  return { kind, mode, path, stage };
}

async function gitIndexEntriesFrom(repositoryRootPath: string): Promise<readonly GitIndexEntry[]> {
  const output = await commandOutput(
    "git",
    ["ls-files", "--full-name", "--stage", "-z", "--cached"],
    repositoryRootPath,
  );
  const entries = output
    .split("\0")
    .filter((record: string): boolean => record.length > 0)
    .map((record: string): GitIndexEntry => parseGitIndexEntry(record));
  validateGitPathNames(entries.map((entry: GitIndexEntry): string => entry.path));
  return entries.toSorted((left, right): number => left.path.localeCompare(right.path));
}

async function repositoryRoot(): Promise<string> {
  const output = await commandOutput("git", ["rev-parse", "--show-toplevel"]);
  return output.trim();
}

async function gitPathsFrom(
  repositoryRootPath: string,
  args: readonly string[],
): Promise<readonly string[]> {
  const output = await commandOutput(
    "git",
    ["ls-files", "--full-name", "-z", ...args],
    repositoryRootPath,
  );

  return gitPaths(output);
}

async function ignoredIndexPathDetails(
  repositoryRootPath: string,
  paths: readonly string[],
): Promise<readonly string[]> {
  if (paths.length === 0) {
    return [];
  }

  const output = await commandOutputWithInput(
    "git",
    ["check-ignore", "--stdin", "-z", "-v", "--no-index", "--non-matching"],
    paths.map((path: string): string => `${path}\0`).join(""),
    repositoryRootPath,
    [0, 1],
  );
  const fields = output.split("\0");
  const ignoredPaths: string[] = [];

  for (let index = 0; index + 3 < fields.length; index += 4) {
    const [source, line, pattern, path] = fields.slice(index, index + 4);

    if (
      typeof source === "string" &&
      typeof line === "string" &&
      typeof pattern === "string" &&
      typeof path === "string" &&
      ignoredByPositivePattern(pattern)
    ) {
      ignoredPaths.push(`${path} (${source}:${line}: ${pattern})`);
    }
  }

  return ignoredPaths;
}

async function expandIgnoredPath(
  repositoryRootPath: string,
  ignoredPath: string,
): Promise<readonly string[]> {
  if (!ignoredPath.endsWith("/")) {
    return [ignoredPath];
  }

  const paths = await gitPathsFrom(repositoryRootPath, [
    "--others",
    "--ignored",
    "--exclude-standard",
    "--",
    ignoredPath,
  ]);

  return paths.filter((path: string): boolean => !path.endsWith("/"));
}

type ConcurrentResult<Output> = Readonly<{
  readonly value: Output;
}>;

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input, index: number) => Promise<Output>,
): Promise<readonly Output[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw internalInvariantError(`Invalid concurrency limit: ${concurrency}`);
  }

  const entries = [...values.entries()];
  if (entries.length === 0) {
    return [];
  }

  const results: (ConcurrentResult<Output> | undefined)[] = Array.from({
    length: entries.length,
  });
  let nextIndex = 0;

  async function worker(): Promise<void> {
    const entryIndex = nextIndex;
    nextIndex += 1;
    const entry = entries[entryIndex];
    if (entry === undefined) {
      return;
    }

    const [index, value] = entry;
    results[index] = { value: await mapper(value, index) };
    return worker();
  }

  const workerCount = Math.min(concurrency, entries.length);
  await Promise.all(Array.from({ length: workerCount }, (): Promise<void> => worker()));

  return results.map((result: ConcurrentResult<Output> | undefined, index: number): Output => {
    if (result === undefined) {
      throw internalInvariantError(`Missing concurrent result at index ${index}`);
    }

    return result.value;
  });
}

async function digestBytes(bytes: readonly number[]): Promise<string> {
  const view = Uint8Array.from(bytes);
  const input = new ArrayBuffer(view.byteLength);
  new Uint8Array(input).set(view);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte: number): string =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function ignoredFilePaths(repositoryRootPath: string): Promise<readonly string[]> {
  const ignoredPaths = await gitPathsFrom(repositoryRootPath, [
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
  ]);
  const expandedPaths = await mapWithConcurrency(
    ignoredPaths,
    MAX_CONCURRENT_FILE_SPEC_PROCESSES,
    (ignoredPath: string): Promise<readonly string[]> =>
      expandIgnoredPath(repositoryRootPath, ignoredPath),
  );

  return [...new Set(expandedPaths.flat())].toSorted();
}

async function digestFile(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  return digestBytes([...bytes]);
}

async function digestText(text: string): Promise<string> {
  return await digestBytes([...new globalThis.TextEncoder().encode(text)]);
}

async function toolExecutableBytes(
  command: FileSpecCommand,
  executable: string,
): Promise<Uint8Array> {
  try {
    return await Deno.readFile(executable);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw toolExecutionError(command, executable, [], undefined, detail);
  }
}

async function toolIdentity(command: FileSpecCommand): Promise<ToolIdentity> {
  const executable = resolveToolExecutable(command);
  const version = await commandOutput(command, FILE_SPEC_COMMANDS[command].versionArguments);
  const executableBytes = await toolExecutableBytes(command, executable);

  return {
    command,
    executable,
    sha256: await digestBytes([...executableBytes]),
    version: version.trim(),
  };
}

async function gitInfoExcludePath(repositoryRootPath: string): Promise<string> {
  const output = await commandOutput(
    "git",
    ["rev-parse", "--git-path", "info/exclude"],
    repositoryRootPath,
  );
  const path = output.trim();
  return path.startsWith("/") ? path : join(repositoryRootPath, path);
}

async function globalIgnorePath(repositoryRootPath: string): Promise<string | undefined> {
  const output = await commandOutput(
    "git",
    ["config", "--path", "--get", "core.excludesFile"],
    repositoryRootPath,
    [0, 1],
  );
  const path = output.trim();
  return path.length === 0 ? undefined : path;
}

async function optionalFileBytes(path: string): Promise<Uint8Array | undefined> {
  try {
    return await Deno.readFile(path);
  } catch (error: unknown) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }

    throw error;
  }
}

async function ignoreSourcesDigest(repositoryRootPath: string): Promise<string> {
  const gitIgnorePaths = await gitPathsFrom(repositoryRootPath, [
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    ".gitignore",
    "**/.gitignore",
  ]);
  const infoExcludePath = await gitInfoExcludePath(repositoryRootPath);
  const configuredGlobalIgnorePath = await globalIgnorePath(repositoryRootPath);
  const sourcePaths = [
    ...gitIgnorePaths.map((path: string): string => join(repositoryRootPath, path)),
    infoExcludePath,
    ...(configuredGlobalIgnorePath === undefined ? [] : [configuredGlobalIgnorePath]),
  ].toSorted();
  const uniqueSourcePaths = [...new Set(sourcePaths)];
  const sourceParts = await Promise.all(
    uniqueSourcePaths.map(async (path: string): Promise<string> => {
      const bytes = await optionalFileBytes(path);
      const digest = bytes === undefined ? "missing" : await digestBytes([...bytes]);
      return `${path}\0${digest}`;
    }),
  );

  return digestText(sourceParts.join("\0"));
}

async function gitHead(repositoryRootPath: string): Promise<string> {
  const output = await commandOutput(
    "git",
    ["rev-parse", "--verify", "HEAD"],
    repositoryRootPath,
    [0, 128],
  );
  const head = output.trim();
  return head.length === 0 ? "(unborn)" : head;
}

async function gitIndexTree(repositoryRootPath: string): Promise<string> {
  const output = await commandOutput("git", ["write-tree"], repositoryRootPath);
  const tree = output.trim();
  if (tree.length === 0) {
    throw internalInvariantError("git write-tree returned an empty tree ID");
  }

  return tree;
}

async function enumerationDigest(enumeration: RepositoryEnumeration): Promise<string> {
  return await digestText(JSON.stringify(enumeration));
}

async function repositorySnapshot(
  repositoryRootPath: string,
  enumeration: RepositoryEnumeration,
): Promise<RepositorySnapshot> {
  const [head, indexTree, fileSpecSha256, ignoreSourcesSha256, enumerationSha256, tools] =
    await Promise.all([
      gitHead(repositoryRootPath),
      gitIndexTree(repositoryRootPath),
      digestFile(join(repositoryRootPath, "fileSpec.cue")),
      ignoreSourcesDigest(repositoryRootPath),
      enumerationDigest(enumeration),
      Promise.all([toolIdentity("cue"), toolIdentity("git")]),
    ]);

  return {
    enumerationSha256,
    fileSpecSha256,
    head,
    ignoreSourcesSha256,
    indexTree,
    tools,
  };
}

export {
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
};
export type {
  FileSpecCommand,
  GitIndexEntry,
  RepositoryEnumeration,
  RepositorySnapshot,
  ToolIdentity,
};
