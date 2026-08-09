import {
  commandOutput,
  denoToolIdentity,
  digestFile,
  digestText,
  toolIdentity,
} from "coolheaded/repo/layout/command.ts";
import {
  conformanceViolation,
  inputDecodeError,
  internalInvariantError,
} from "coolheaded/repo/layout/model.ts";
import type { RepositorySnapshot } from "coolheaded/repo/layout/types.ts";
import { join } from "@jsr/std__path";

type GitNodeKind = "file" | "executable" | "symlink" | "gitlink";

type GitIndexEntry = Readonly<{
  readonly kind: GitNodeKind;
  readonly mode: string;
  readonly path: string;
  readonly stage: number;
}>;

type RepositoryEnumeration = Readonly<{
  readonly indexPaths: readonly string[];
  readonly visiblePaths: readonly string[];
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
  const [head, indexTree, layoutSha256, enumerationSha256, cue, deno, git] = await Promise.all([
    gitHead(repositoryRootPath),
    gitIndexTree(repositoryRootPath),
    digestFile(join(repositoryRootPath, "layout.cue")),
    enumerationDigest(enumeration),
    toolIdentity("cue"),
    denoToolIdentity(),
    toolIdentity("git"),
  ]);

  return {
    enumerationSha256,
    head,
    indexTree,
    layoutSha256,
    tools: { cue, deno, git },
  };
}

export {
  gitIndexEntriesFrom,
  gitPaths,
  gitPathsFrom,
  repositoryRoot,
  repositorySnapshot,
  validateGitPathNames,
};
export type { GitIndexEntry, RepositoryEnumeration };
