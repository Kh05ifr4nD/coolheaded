import childProcess from "node:child_process";
import fs from "node:fs";
import nodePath from "node:path";
import nodeProcess from "node:process";
import url from "node:url";

/**
 * @typedef {{
 *   readonly error?: Error,
 *   readonly signal: string | null,
 *   readonly status: number | null,
 *   readonly stderr: string,
 *   readonly stdout: string,
 * }} SpawnResult
 * @typedef {{
 *   spawnSync(
 *     command: string,
 *     arguments_: readonly string[],
 *     options: Readonly<{ cwd: string, encoding: "utf8", maxBuffer: number }>,
 *   ): SpawnResult,
 * }} ChildProcess
 * @typedef {{
 *   existsSync(path: string): boolean,
 *   realpathSync(path: string): string,
 *   statSync(path: string): Readonly<{ isDirectory(): boolean, isFile(): boolean }>,
 * }} FileSystem
 * @typedef {{
 *   isAbsolute(path: string): boolean,
 *   join(...paths: string[]): string,
 *   posix: Readonly<{ isAbsolute(path: string): boolean, normalize(path: string): string }>,
 *   relative(from: string, to: string): string,
 *   resolve(...paths: string[]): string,
 *   readonly sep: string,
 * }} Path
 * @typedef {{
 *   readonly argv: readonly [string, string, ...string[]],
 *   cwd(): string,
 *   readonly execPath: string,
 *   readonly stdout: Readonly<{ write(chunk: string): void }>,
 * }} NodeProcess
 * @typedef {{ pathToFileURL(path: string): Readonly<{ href: string }> }} Url
 */

/** @type {ChildProcess} */
const nodeChildProcess = childProcess;
/** @type {FileSystem} */
const nodeFileSystem = fs;
/** @type {Path} */
const path = nodePath;
/** @type {NodeProcess} */
const process = nodeProcess;
/** @type {Url} */
const nodeUrl = url;

const MAX_TRACE_OUTPUT_BYTES = 64 * 1024 * 1024;
const TRACE_WARNING_PREFIX = "trace warning: ";
const UPSTREAM_TRACE_FILE = "scripts/trace-daemon-upstream.mjs";

/**
 * Each accepted warning names the concrete runtime artifact that makes the
 * static-analysis gap safe. Warnings, policies, and compensations must remain
 * mutually supported so upstream drift cannot leave stale exceptions behind.
 *
 * @type {readonly Readonly<{
 *   id: string,
 *   manifestPattern: RegExp,
 *   warningPattern: RegExp,
 * }>[]}
 */
const WARNING_POLICIES = [
  {
    id: "development daemon source",
    manifestPattern: /^packages\/server\/dist\/server\/server\/daemon-worker\.js$/u,
    warningPattern:
      /^Failed to parse .*\/packages\/server\/src\/server\/daemon-worker\.ts as module:\nUnexpected token \(\d+:\d+\)$/u,
  },
  {
    id: "Parcel watcher native package",
    manifestPattern: /^node_modules\/@parcel\/watcher-[^/]+\/watcher\.node$/u,
    warningPattern:
      /^Failed to resolve dependency "(?:\.\/build\/(?:Release|Debug)\/watcher\.node|@parcel\/watcher-[^"]+)":\nCannot find module .* loaded from .*\/node_modules\/@parcel\/watcher\/index\.js$/u,
  },
  {
    id: "ws buffer fallback",
    manifestPattern: /^node_modules\/ws\/lib\/buffer-util\.js$/u,
    warningPattern:
      /^Failed to resolve dependency "bufferutil":\nCannot find module 'bufferutil' loaded from .*\/node_modules\/ws\/lib\/buffer-util\.js$/u,
  },
  {
    id: "ws UTF-8 fallback",
    manifestPattern: /^node_modules\/ws\/lib\/validation\.js$/u,
    warningPattern:
      /^Failed to resolve dependency "utf-8-validate":\nCannot find module 'utf-8-validate' loaded from .*\/node_modules\/ws\/lib\/validation\.js$/u,
  },
  {
    id: "Zsh integration asset",
    manifestPattern:
      /^packages\/server\/dist\/server\/terminal\/shell-integration\/zsh\/\.zshenv$/u,
    warningPattern:
      /^Failed to parse .*\/packages\/server\/dist\/server\/terminal\/shell-integration\/zsh\/\.zshenv as (?:module|script):\nUnexpected token \(\d+:\d+\)$/u,
  },
];

class RuntimeClosureError extends Error {
  /**
   * @param {string} message
   * @param {{ readonly cause?: unknown }} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = "RuntimeClosureError";
  }
}

/**
 * @param {string} stderr
 * @returns {readonly string[]}
 */
function parseTraceWarnings(stderr) {
  const output = stderr.trim();
  if (output.length === 0) {
    return [];
  }
  if (!output.startsWith(TRACE_WARNING_PREFIX)) {
    throw new RuntimeClosureError(`unexpected stderr from upstream runtime trace:\n${output}`);
  }

  const [preamble, ...warnings] = output.split(TRACE_WARNING_PREFIX);
  if (preamble !== "" || warnings.some((warning) => warning.trim().length === 0)) {
    throw new RuntimeClosureError(`malformed upstream runtime trace warnings:\n${output}`);
  }
  return warnings.map((warning) => warning.trim());
}

/**
 * @param {string} stdout
 * @returns {readonly string[]}
 */
function parseRuntimeManifest(stdout) {
  const entries = stdout.split(/\r?\n/u);
  if (entries.at(-1) === "") {
    entries.pop();
  }
  if (entries.length === 0 || entries.some((entry) => entry.length === 0)) {
    throw new RuntimeClosureError("runtime manifest must contain only non-empty paths");
  }

  for (const entry of entries) {
    if (
      entry === "." ||
      entry === ".." ||
      path.posix.isAbsolute(entry) ||
      entry.startsWith("../") ||
      path.posix.normalize(entry) !== entry
    ) {
      throw new RuntimeClosureError(`invalid runtime path: ${entry}`);
    }
  }
  if (new Set(entries).size !== entries.length) {
    throw new RuntimeClosureError("runtime manifest contains duplicate paths");
  }
  let previousEntry = "";
  for (const entry of entries) {
    if (previousEntry > entry) {
      throw new RuntimeClosureError("runtime manifest paths must be sorted");
    }
    previousEntry = entry;
  }
  return entries;
}

/**
 * @param {readonly string[]} warnings
 * @param {readonly string[]} manifest
 * @returns {void}
 */
function enforceTraceWarningPolicy(warnings, manifest) {
  const matchedPolicyIds = new Set();
  for (const warning of warnings) {
    const policies = WARNING_POLICIES.filter(({ warningPattern }) => warningPattern.test(warning));
    if (policies.length !== 1) {
      throw new RuntimeClosureError(`unknown trace warning:\n${warning}`);
    }

    const [policy] = policies;
    matchedPolicyIds.add(policy.id);
    if (!manifest.some((entry) => policy.manifestPattern.test(entry))) {
      throw new RuntimeClosureError(`missing runtime compensation for ${policy.id}:\n${warning}`);
    }
  }

  for (const policy of WARNING_POLICIES) {
    if (!matchedPolicyIds.has(policy.id)) {
      throw new RuntimeClosureError(`missing trace warning for ${policy.id}`);
    }
  }
}

/**
 * @param {string} sourceRoot
 * @param {readonly string[]} manifest
 * @returns {void}
 */
function assertManifestEntriesSafe(sourceRoot, manifest) {
  const resolvedSourceRoot = nodeFileSystem.realpathSync(sourceRoot);
  for (const entry of manifest) {
    const candidate = path.join(resolvedSourceRoot, entry);
    if (!nodeFileSystem.existsSync(candidate)) {
      throw new RuntimeClosureError(`runtime manifest path does not exist: ${entry}`);
    }

    const resolvedCandidate = nodeFileSystem.realpathSync(candidate);
    const relativeCandidate = path.relative(resolvedSourceRoot, resolvedCandidate);
    if (
      relativeCandidate === "" ||
      relativeCandidate === ".." ||
      relativeCandidate.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeCandidate)
    ) {
      throw new RuntimeClosureError(`runtime manifest path escapes source root: ${entry}`);
    }
    const statistics = nodeFileSystem.statSync(resolvedCandidate);
    if (!statistics.isFile() && !statistics.isDirectory()) {
      throw new RuntimeClosureError(`runtime manifest path has unsupported type: ${entry}`);
    }
  }
}

/**
 * @param {string} sourceRoot
 * @returns {string}
 */
function traceRuntimeClosure(sourceRoot) {
  const upstreamTrace = path.join(sourceRoot, UPSTREAM_TRACE_FILE);
  const result = nodeChildProcess.spawnSync(process.execPath, [upstreamTrace], {
    cwd: sourceRoot,
    encoding: "utf8",
    maxBuffer: MAX_TRACE_OUTPUT_BYTES,
  });
  if (result.error !== undefined) {
    throw new RuntimeClosureError("failed to execute upstream runtime trace", {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new RuntimeClosureError(
      `upstream runtime trace exited ${result.status ?? `from signal ${result.signal}`}\n${result.stderr}`,
    );
  }
  if (typeof result.stdout !== "string" || typeof result.stderr !== "string") {
    throw new RuntimeClosureError("upstream runtime trace returned non-text output");
  }

  const manifest = parseRuntimeManifest(result.stdout);
  assertManifestEntriesSafe(sourceRoot, manifest);
  enforceTraceWarningPolicy(parseTraceWarnings(result.stderr), manifest);
  return result.stdout;
}

const [, entryPath] = process.argv;
if (import.meta.url === nodeUrl.pathToFileURL(path.resolve(entryPath)).href) {
  process.stdout.write(traceRuntimeClosure(process.cwd()));
}

export {
  RuntimeClosureError,
  enforceTraceWarningPolicy,
  parseRuntimeManifest,
  parseTraceWarnings,
  traceRuntimeClosure,
};
