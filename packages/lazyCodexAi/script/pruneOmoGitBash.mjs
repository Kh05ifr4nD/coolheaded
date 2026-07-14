import fs from "node:fs";

/**
 * @typedef {{
 *   readFileSync(file: string, encoding: "utf8"): string,
 *   writeFileSync(file: string, contents: string): void,
 * }} FileSystem
 * @typedef {Record<string, unknown>} JsonRecord
 * @typedef {{ readonly env: Readonly<Record<string, string | undefined>> }} NodeProcess
 */

/** @type {FileSystem} */
const nodeFs = fs;

/**
 * @param {unknown} value
 * @returns {value is JsonRecord}
 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is Readonly<Record<string, string | undefined>>}
 */
function isEnvironment(value) {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => entry === undefined || typeof entry === "string")
  );
}

/**
 * @param {unknown} value
 * @returns {value is NodeProcess}
 */
function isNodeProcess(value) {
  return isRecord(value) && isEnvironment(value.env);
}

/**
 * @param {JsonRecord} record
 * @param {string} key
 * @param {string} file
 * @returns {JsonRecord}
 */
function requiredRecord(record, key, file) {
  const value = record[key];
  if (!isRecord(value)) {
    throw new Error(`${file}: expected object at ${key}`);
  }
  return value;
}

/**
 * @param {JsonRecord} record
 * @param {string} key
 * @param {string} file
 * @returns {readonly string[]}
 */
function requiredStringArray(record, key, file) {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${file}: expected string array at ${key}`);
  }
  return value;
}

/**
 * @param {string} root
 * @param {string} path
 * @returns {string}
 */
function joinPath(root, path) {
  return `${root.replace(/\/$/u, "")}/${path}`;
}

/**
 * @param {string} file
 * @returns {JsonRecord}
 */
function readJson(file) {
  const value = JSON.parse(nodeFs.readFileSync(file, "utf8"));
  if (!isRecord(value)) {
    throw new Error(`${file}: expected JSON object`);
  }
  return value;
}

/**
 * @param {string} file
 * @param {JsonRecord} value
 * @param {string | number} indentation
 * @returns {void}
 */
function writeJson(file, value, indentation) {
  nodeFs.writeFileSync(file, `${JSON.stringify(value, null, indentation)}\n`);
}

/**
 * @param {JsonRecord} record
 * @param {string} key
 * @param {readonly string[]} removedValues
 * @param {string} file
 * @returns {void}
 */
function removeArrayValues(record, key, removedValues, file) {
  const values = requiredStringArray(record, key, file);
  const removed = new Set(removedValues);
  record[key] = values.filter((value) => !removed.has(value));
}

/**
 * @param {string} file
 * @param {string} source
 * @param {string} before
 * @param {string} after
 * @returns {string}
 */
function replaceExactly(file, source, before, after) {
  const first = source.indexOf(before);
  if (first === -1) {
    throw new Error(`${file}: expected runtime fragment is missing`);
  }
  if (source.includes(before, first + before.length)) {
    throw new Error(`${file}: expected one runtime fragment, found multiple`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

/**
 * @param {string} file
 * @returns {void}
 */
function pruneRuntimeConfig(file) {
  let source = nodeFs.readFileSync(file, "utf8");
  source = replaceExactly(
    file,
    source,
    '  const gitBashEnabled = (input.platform ?? process.platform) === "win32" && input.gitBashEnabled === true;\n',
    "",
  );
  source = replaceExactly(
    file,
    source,
    '  nextConfig = ensurePluginMcpEnabled(nextConfig, "omo@sisyphuslabs", "git_bash", gitBashEnabled);',
    "  nextConfig = removeGitBashMcpConfig(nextConfig);",
  );
  source = replaceExactly(
    file,
    source,
    "function ensureHookTrusted(config, state) {",
    `function removeGitBashMcpConfig(config) {
  const sectionPath = ["plugins", "omo@sisyphuslabs", "mcp_servers", "git_bash"];
  const withoutSection = removeTomlSections(config, (header) => tomlPathEquals(header, sectionPath));
  return removeTomlAssignment(withoutSection, [...sectionPath, "enabled"]);
}
function tomlPathEquals(input, expected) {
  const parsed = parseTomlDottedKey(input);
  return parsed !== null && parsed.length === expected.length && parsed.every((part, index) => part === expected[index]);
}
function removeTomlAssignment(config, expected) {
  return (config.match(/[^\\n]*\\n?|$/g) ?? []).filter((line) => {
    const key = tomlAssignmentKey(stripUnquotedInlineComment(line));
    return key === null || !tomlPathEquals(key, expected);
  }).join("");
}
function tomlAssignmentKey(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0;index < line.length; index += 1) {
    const char = line[index];
    if (quote !== null) {
      if (quote === '"' && char === "\\\\" && !escaped) {
        escaped = true;
        continue;
      }
      if (char === quote && !escaped)
        quote = null;
      escaped = false;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "=")
      return line.slice(0, index).trim();
  }
  return null;
}
function ensureHookTrusted(config, state) {`,
  );
  nodeFs.writeFileSync(file, source);
}

/** @type {unknown} */
const processCandidate = Reflect.get(globalThis, "process");
if (!isNodeProcess(processCandidate)) {
  throw new TypeError("missing Node process environment");
}
const packageRoot = processCandidate.env.LAZYCODEX_PACKAGE_ROOT;
if (packageRoot === undefined || packageRoot.length === 0) {
  throw new Error("missing LAZYCODEX_PACKAGE_ROOT");
}

const pluginRoot = joinPath(packageRoot, "packages/omo-codex/plugin");

for (const file of [
  "dist/cli-node/index.js",
  "dist/cli/index.js",
  "packages/omo-codex/scripts/install-dist/install-local.mjs",
  "packages/omo-codex/plugin/components/bootstrap/dist/cli.js",
]) {
  pruneRuntimeConfig(joinPath(packageRoot, file));
}

const rootPackageFile = joinPath(packageRoot, "package.json");
const rootPackage = readJson(rootPackageFile);
removeArrayValues(rootPackage, "workspaces", ["packages/git-bash-mcp"], rootPackageFile);
removeArrayValues(
  rootPackage,
  "files",
  ["packages/omo-codex/plugin/components/git-bash/dist/cli.js", "packages/git-bash-mcp/dist"],
  rootPackageFile,
);
writeJson(rootPackageFile, rootPackage, 2);

const pluginPackageFile = joinPath(pluginRoot, "package.json");
const pluginPackage = readJson(pluginPackageFile);
removeArrayValues(pluginPackage, "workspaces", ["components/git-bash"], pluginPackageFile);
writeJson(pluginPackageFile, pluginPackage, 2);

const pluginLockFile = joinPath(pluginRoot, "package-lock.json");
const pluginLock = readJson(pluginLockFile);
const lockPackages = requiredRecord(pluginLock, "packages", pluginLockFile);
const lockRoot = requiredRecord(lockPackages, "", pluginLockFile);
removeArrayValues(lockRoot, "workspaces", ["components/git-bash"], pluginLockFile);
delete lockPackages["components/git-bash"];
delete lockPackages["node_modules/@sisyphuslabs/codex-git-bash-hook"];
writeJson(pluginLockFile, pluginLock, "\t");

const mcpFile = joinPath(pluginRoot, ".mcp.json");
const mcp = readJson(mcpFile);
delete requiredRecord(mcp, "mcpServers", mcpFile).git_bash;
writeJson(mcpFile, mcp, "\t");

const manifestFile = joinPath(pluginRoot, ".codex-plugin/plugin.json");
const manifest = readJson(manifestFile);
manifest.hooks = requiredStringArray(manifest, "hooks", manifestFile).filter(
  (hook) => !hook.includes("git-bash"),
);
const pluginInterface = requiredRecord(manifest, "interface", manifestFile);
if (typeof pluginInterface.longDescription !== "string") {
  throw new TypeError(`${manifestFile}: expected string at interface.longDescription`);
}
pluginInterface.longDescription = pluginInterface.longDescription.replace("Git Bash, ", "");
writeJson(manifestFile, manifest, 2);
