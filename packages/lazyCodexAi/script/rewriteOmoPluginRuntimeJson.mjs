import fs from "node:fs";

/**
 * @typedef {{
 *   readonly name: string,
 *   isDirectory(): boolean,
 *   isFile(): boolean,
 * }} DirectoryEntry
 * @typedef {{
 *   readdirSync(root: string, options: { readonly withFileTypes: true }): readonly DirectoryEntry[],
 *   readFileSync(file: string, encoding: "utf8"): string,
 *   writeFileSync(file: string, contents: string): void,
 * }} FileSystem
 * @typedef {Record<string, unknown>} JsonRecord
 * @typedef {{ readonly env: Readonly<Record<string, string | undefined>> }} NodeProcess
 */

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

/** @type {FileSystem} */
const nodeFs = fs;
/** @type {unknown} */
const processCandidate = Reflect.get(globalThis, "process");
if (!isNodeProcess(processCandidate)) {
  throw new Error("missing Node process environment");
}

/**
 * @param {string} name
 * @returns {string}
 */
function requiredEnv(name) {
  const value = processCandidate.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

const pluginRoot = requiredEnv("LAZYCODEX_PLUGIN_ROOT");
const nodeExecutable = requiredEnv("LAZYCODEX_NODE_EXECUTABLE");
const codeGraphExecutable = requiredEnv("LAZYCODEX_CODEGRAPH_EXECUTABLE");

/**
 * @param {string} file
 * @returns {string}
 */
function pluginPath(file) {
  const rootPrefix = pluginRoot.endsWith("/") ? pluginRoot : `${pluginRoot}/`;
  return file.startsWith(rootPrefix) ? file.slice(rootPrefix.length) : file;
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function isRuntimeJsonPath(file) {
  const relative = pluginPath(file);
  return (
    relative === ".mcp.json" ||
    relative.startsWith("hooks/") ||
    relative.endsWith("/.mcp.json") ||
    relative.includes("/hooks/")
  );
}

/**
 * @param {string} root
 * @param {string} name
 * @returns {string}
 */
function joinPath(root, name) {
  return `${root.replace(/\/$/u, "")}/${name}`;
}

/**
 * @param {string} root
 * @returns {readonly string[]}
 */
function runtimeJsonFiles(root) {
  const files = [];
  for (const entry of nodeFs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name !== ".git" && entry.name !== "node_modules") {
      const file = joinPath(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...runtimeJsonFiles(file));
      } else if (entry.isFile() && entry.name.endsWith(".json") && isRuntimeJsonPath(file)) {
        files.push(file);
      }
    }
  }
  return files;
}

/**
 * @param {string} command
 * @returns {string}
 */
function nixNodeCommand(command) {
  if (command === "node") {
    return nodeExecutable;
  }
  if (command.startsWith("node ")) {
    return nodeExecutable + command.slice("node".length);
  }
  return command;
}

/**
 * @param {string} command
 * @returns {string}
 */
function nixCodeGraphCommand(command) {
  const next = nixNodeCommand(command);
  if (!next.includes("components/codegraph/dist/cli.js")) {
    return next;
  }
  const prefix = `OMO_CODEGRAPH_BIN=${codeGraphExecutable} `;
  return next.startsWith("OMO_CODEGRAPH_BIN=")
    ? next.replace(/^OMO_CODEGRAPH_BIN=\S+\s+/u, prefix)
    : prefix + next;
}

/**
 * @param {unknown} value
 * @param {(record: JsonRecord) => void} visit
 * @returns {void}
 */
function visitRecords(value, visit) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      visitRecords(entry, visit);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  visit(value);
  for (const entry of Object.values(value)) {
    visitRecords(entry, visit);
  }
}

/**
 * @param {unknown} parsed
 * @returns {boolean}
 */
function rewriteCommands(parsed) {
  let changed = false;
  visitRecords(parsed, (record) => {
    const commandValue = record.command;
    if (typeof commandValue !== "string") {
      return;
    }
    const command = nixCodeGraphCommand(commandValue);
    if (command !== commandValue) {
      record.command = command;
      changed = true;
    }
  });
  return changed;
}

/**
 * @param {unknown} parsed
 * @returns {boolean}
 */
function stampCodeGraphEnv(parsed) {
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
    return false;
  }
  const { codegraph } = parsed.mcpServers;
  if (!isRecord(codegraph)) {
    return false;
  }
  const env = isEnvironment(codegraph.env) ? codegraph.env : {};
  if (env.OMO_CODEGRAPH_BIN === codeGraphExecutable) {
    return false;
  }
  codegraph.env = { ...env, OMO_CODEGRAPH_BIN: codeGraphExecutable };
  return true;
}

for (const file of runtimeJsonFiles(pluginRoot)) {
  /** @type {unknown} */
  const parsed = JSON.parse(nodeFs.readFileSync(file, "utf8"));
  const commandsChanged = rewriteCommands(parsed);
  const codeGraphEnvChanged =
    file === joinPath(pluginRoot, ".mcp.json") && stampCodeGraphEnv(parsed);
  const changed = commandsChanged || codeGraphEnvChanged;

  if (changed) {
    nodeFs.writeFileSync(file, `${JSON.stringify(parsed, null, "\t")}\n`);
  }
}
