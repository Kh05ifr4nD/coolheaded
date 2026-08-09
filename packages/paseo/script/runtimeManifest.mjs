import { RuntimeClosureError } from "./runtimeContract.mjs";
import fs from "node:fs";
import nodePath from "node:path";

/**
 * @typedef {{ isDirectory(): boolean, isFile(): boolean, isSymbolicLink(): boolean }} FileStatus
 * @typedef {{
 *   existsSync(path: string): boolean,
 *   lstatSync(path: string): FileStatus,
 *   readlinkSync(path: string): string,
 *   realpathSync(path: string): string,
 *   statSync(path: string): FileStatus,
 * }} FileSystem
 * @typedef {{
 *   isAbsolute(path: string): boolean,
 *   join(...paths: string[]): string,
 *   posix: Readonly<{
 *     dirname(path: string): string,
 *     isAbsolute(path: string): boolean,
 *     join(...paths: string[]): string,
 *     normalize(path: string): string,
 *   }>,
 *   relative(from: string, to: string): string,
 *   readonly sep: string,
 * }} Path
 */

/** @type {FileSystem} */
const nodeFileSystem = fs;
/** @type {Path} */
const path = nodePath;

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
      entry.startsWith("-") ||
      entry.endsWith("/") ||
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
 * Projects the upstream manifest onto explicit copyable leaves. Directories
 * are structural hints only; preserving them would let `cp -a` recursively
 * copy descendants that were never individually audited.
 *
 * @param {string} sourceRoot
 * @param {readonly string[]} manifest
 * @param {FileSystem} [fileSystem]
 * @returns {readonly string[]}
 */
function materializeRuntimeManifest(sourceRoot, manifest, fileSystem = nodeFileSystem) {
  const resolvedSourceRoot = fileSystem.realpathSync(sourceRoot);
  /** @type {string[]} */
  const leafEntries = [];
  /** @type {Map<string, string>} */
  const symlinkTargets = new Map();

  for (const entry of manifest) {
    const candidate = path.join(resolvedSourceRoot, entry);
    if (!fileSystem.existsSync(candidate)) {
      throw new RuntimeClosureError(`runtime manifest path does not exist: ${entry}`);
    }

    const resolvedCandidate = fileSystem.realpathSync(candidate);
    const relativeCandidate = path.relative(resolvedSourceRoot, resolvedCandidate);
    if (
      relativeCandidate === "" ||
      relativeCandidate === ".." ||
      relativeCandidate.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeCandidate)
    ) {
      throw new RuntimeClosureError(`runtime manifest path escapes source root: ${entry}`);
    }

    const linkStatus = fileSystem.lstatSync(candidate);
    if (!linkStatus.isDirectory()) {
      if (linkStatus.isFile()) {
        leafEntries.push(entry);
      } else {
        if (!linkStatus.isSymbolicLink()) {
          throw new RuntimeClosureError(`runtime manifest path has unsupported type: ${entry}`);
        }

        const linkTarget = fileSystem.readlinkSync(candidate);
        if (path.isAbsolute(linkTarget)) {
          throw new RuntimeClosureError(
            `runtime manifest symlink target must be relative: ${entry}`,
          );
        }
        const relocatedTarget = path.posix.normalize(
          path.posix.join(path.posix.dirname(entry), linkTarget),
        );
        if (
          relocatedTarget === "." ||
          relocatedTarget === ".." ||
          relocatedTarget.startsWith("../") ||
          path.posix.isAbsolute(relocatedTarget)
        ) {
          throw new RuntimeClosureError(`runtime manifest symlink escapes output root: ${entry}`);
        }

        const targetStatus = fileSystem.statSync(resolvedCandidate);
        if (!targetStatus.isFile() && !targetStatus.isDirectory()) {
          throw new RuntimeClosureError(
            `runtime manifest symlink has unsupported target: ${entry}`,
          );
        }
        leafEntries.push(entry);
        symlinkTargets.set(entry, relocatedTarget);
      }
    }
  }

  if (leafEntries.length === 0) {
    throw new RuntimeClosureError("runtime manifest must contain explicit leaf paths");
  }

  const leafEntrySet = new Set(leafEntries);
  for (const [entry, target] of symlinkTargets) {
    if (
      !leafEntrySet.has(target) &&
      !leafEntries.some((leafEntry) => leafEntry.startsWith(`${target}/`))
    ) {
      throw new RuntimeClosureError(
        `runtime manifest omits symlink target for ${entry}: ${target}`,
      );
    }
  }
  return leafEntries;
}

export { materializeRuntimeManifest, parseRuntimeManifest };
