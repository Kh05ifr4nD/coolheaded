import {
  RuntimeClosureError,
  enforceTraceWarningPolicy,
  parseTraceWarnings,
} from "./runtimeContract.mjs";
import {
  addExplicitRuntimeFiles,
  materializeRuntimeManifest,
  parseRuntimeManifest,
} from "./runtimeManifest.mjs";
import childProcess from "node:child_process";
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
 * @typedef {{ join(...paths: string[]): string, resolve(...paths: string[]): string }} Path
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
/** @type {Path} */
const path = nodePath;
/** @type {NodeProcess} */
const process = nodeProcess;
/** @type {Url} */
const nodeUrl = url;

const MAX_TRACE_OUTPUT_BYTES = 64 * 1024 * 1024;
const UPSTREAM_TRACE_FILE = "scripts/trace-daemon-upstream.mjs";

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

  const manifest = materializeRuntimeManifest(
    sourceRoot,
    addExplicitRuntimeFiles(parseRuntimeManifest(result.stdout)),
  );
  enforceTraceWarningPolicy(parseTraceWarnings(result.stderr), manifest);
  return `${manifest.join("\n")}\n`;
}

const [, entryPath] = process.argv;
if (import.meta.url === nodeUrl.pathToFileURL(path.resolve(entryPath)).href) {
  process.stdout.write(traceRuntimeClosure(process.cwd()));
}

export { traceRuntimeClosure };
