import fs from "node:fs";

// Allow: SIZE_OK — one fail-closed transformation pipeline must evolve atomically with the bundle contract.

/**
 * @typedef {{
 *   readFileSync(file: string, encoding: "utf8"): string,
 *   writeFileSync(file: string, contents: string): void,
 * }} FileSystem
 * @typedef {{ readonly env: Readonly<Record<string, string | undefined>> }} NodeProcess
 * @typedef {{
 *   cleanupIsAbsolute: string,
 *   cleanupJoin: string,
 *   cleanupLstat: string,
 *   cleanupPath: string,
 *   cleanupRelative: string,
 *   cleanupResolve: string,
 *   configDirectoryName: string,
 *   configLstat: string,
 *   configMkdir: string,
 *   configParameter: string,
 *   configReadFile: string,
 *   configWriteFile: string,
 *   formatBackupTimestamp: string,
 *   managedAgentNames: string,
 *   managedConfigParameter: string,
 *   maybeLstat: string,
 *   nodeErrorCode: string,
 *   safetyJoin: string,
 *   safetyResolve: string,
 * }} CleanupRuntimeBindings
 */

/** @type {FileSystem} */
const nodeFs = fs;

/**
 * @param {unknown} value
 * @returns {value is NodeProcess}
 */
function isNodeProcess(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const env = Reflect.get(value, "env");
  return env !== null && typeof env === "object" && !Array.isArray(env);
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
 * @param {string} source
 * @param {RegExp} pattern
 * @returns {Readonly<Record<string, string>>}
 */
function matchRuntimeGroups(file, source, pattern) {
  const matches = [...source.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))];
  if (matches.length !== 1 || matches[0]?.groups === undefined) {
    throw new Error(`${file}: expected one runtime structure, found ${matches.length}`);
  }
  return matches[0].groups;
}

/**
 * @param {Readonly<Record<string, string>>} groups
 * @param {string} name
 * @returns {string}
 */
function runtimeGroup(groups, name) {
  return groups[name];
}

/**
 * Resolve Bun-generated aliases from source markers and function structure.
 * @param {string} file
 * @param {string} source
 * @returns {CleanupRuntimeBindings}
 */
function cleanupRuntimeBindings(file, source) {
  const identifier = String.raw`[A-Za-z_$][A-Za-z0-9_$]*`;
  const cleanupImports = matchRuntimeGroups(
    file,
    source,
    new RegExp(
      String.raw`^// packages/omo-codex/src/install/codex-cleanup\.ts\r?\nimport \{ lstat as (?<cleanupLstat>${identifier}),[^\r\n]* \} from "node:fs/promises";\r?\nimport \{[^\r\n]*\} from "node:os";\r?\nimport \{ isAbsolute as (?<cleanupIsAbsolute>${identifier}), join as (?<cleanupJoin>${identifier}), relative as (?<cleanupRelative>${identifier}), resolve as (?<cleanupResolve>${identifier}) \} from "node:path";`,
      "mu",
    ),
  );
  const configImports = matchRuntimeGroups(
    file,
    source,
    new RegExp(
      String.raw`^// packages/omo-codex/src/install/codex-cleanup-config\.ts\r?\nimport \{ lstat as (?<configLstat>${identifier}), mkdir as (?<configMkdir>${identifier}), readFile as (?<configReadFile>${identifier}), writeFile as (?<configWriteFile>${identifier}) \} from "node:fs/promises";\r?\nimport \{ dirname as (?<configDirectoryName>${identifier}) \} from "node:path";`,
      "mu",
    ),
  );
  const safetyImports = matchRuntimeGroups(
    file,
    source,
    new RegExp(
      String.raw`^// packages/omo-codex/src/install/codex-cleanup-safety\.ts\r?\nimport \{ dirname as ${identifier}, isAbsolute as ${identifier}, join as (?<safetyJoin>${identifier}), relative as ${identifier}, resolve as (?<safetyResolve>${identifier}) \} from "node:path";`,
      "mu",
    ),
  );
  const configFunction = matchRuntimeGroups(
    file,
    source,
    new RegExp(
      String.raw`^function cleanupCodexLightConfigText\((?<configParameter>${identifier})\) \{`,
      "mu",
    ),
  );
  const managedFunction = matchRuntimeGroups(
    file,
    source,
    new RegExp(
      String.raw`^function removeManagedAgentBlocks\((?<managedConfigParameter>${identifier})\) \{\r?\n  const managedAgentNames = new Set\((?<managedAgentNames>${identifier})\);`,
      "mu",
    ),
  );
  const helperFunctions = matchRuntimeGroups(
    file,
    source,
    /^function (?<formatBackupTimestamp>formatBackupTimestamp[0-9]*)\([^\r\n]*\) \{[\s\S]*?^async function configExists\([^\r\n]*\) \{[\s\S]*?^[ \t]+if \((?<nodeErrorCode>nodeErrorCode[0-9]*)\([^\r\n]*\) === "ENOENT"\)[\s\S]*?^async function (?<maybeLstat>maybeLstat[0-9]*)\(/mu,
  );
  const cleanupFunctions = matchRuntimeGroups(
    file,
    source,
    new RegExp(
      String.raw`^async function removeManagedPathBestEffort\((?<cleanupPath>${identifier}), seams\) \{`,
      "mu",
    ),
  );

  return {
    cleanupIsAbsolute: runtimeGroup(cleanupImports, "cleanupIsAbsolute"),
    cleanupJoin: runtimeGroup(cleanupImports, "cleanupJoin"),
    cleanupLstat: runtimeGroup(cleanupImports, "cleanupLstat"),
    cleanupPath: runtimeGroup(cleanupFunctions, "cleanupPath"),
    cleanupRelative: runtimeGroup(cleanupImports, "cleanupRelative"),
    cleanupResolve: runtimeGroup(cleanupImports, "cleanupResolve"),
    configDirectoryName: runtimeGroup(configImports, "configDirectoryName"),
    configLstat: runtimeGroup(configImports, "configLstat"),
    configMkdir: runtimeGroup(configImports, "configMkdir"),
    configParameter: runtimeGroup(configFunction, "configParameter"),
    configReadFile: runtimeGroup(configImports, "configReadFile"),
    configWriteFile: runtimeGroup(configImports, "configWriteFile"),
    formatBackupTimestamp: runtimeGroup(helperFunctions, "formatBackupTimestamp"),
    managedAgentNames: runtimeGroup(managedFunction, "managedAgentNames"),
    managedConfigParameter: runtimeGroup(managedFunction, "managedConfigParameter"),
    maybeLstat: runtimeGroup(helperFunctions, "maybeLstat"),
    nodeErrorCode: runtimeGroup(helperFunctions, "nodeErrorCode"),
    safetyJoin: runtimeGroup(safetyImports, "safetyJoin"),
    safetyResolve: runtimeGroup(safetyImports, "safetyResolve"),
  };
}

/**
 * @param {string} file
 * @param {string} source
 * @param {string} start
 * @param {string} end
 * @param {string} replacement
 * @returns {string}
 */
function replaceRange(file, source, start, end, replacement) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`${file}: expected runtime range is missing`);
  }
  if (source.includes(start, startIndex + start.length)) {
    throw new Error(`${file}: expected one runtime range, found multiple`);
  }
  return `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex)}`;
}

/**
 * @param {string} file
 * @returns {void}
 */
function hardenAtomicConfigWriter(file) {
  let source = nodeFs.readFileSync(file, "utf8");
  const start = source.indexOf("async function writeFileAtomic(targetPath, data) {");
  const end = source.indexOf("async function renameWithRetry", start);
  if (start === -1 || end === -1) {
    throw new Error(`${file}: atomic Codex config writer is missing`);
  }
  const fragment = source.slice(start, end);
  const lstatAlias = /const linkStats = await (?<lstat>[A-Za-z0-9_]+)\(targetPath\);/u.exec(
    fragment,
  );
  const pathAliases =
    /linkValue : (?<resolve>[A-Za-z0-9_]+)\((?<dirname>[A-Za-z0-9_]+)\(targetPath\), linkValue\);/u.exec(
      fragment,
    );
  const writer = /await (?<writeFile>[A-Za-z0-9_]+)\(temporaryPath, data\);/u.exec(fragment);
  const lstat = lstatAlias?.groups?.lstat;
  const resolve = pathAliases?.groups?.resolve;
  const dirname = pathAliases?.groups?.dirname;
  const writeFile = writer?.groups?.writeFile;
  if (
    lstat === undefined ||
    resolve === undefined ||
    dirname === undefined ||
    writeFile === undefined
  ) {
    throw new Error(`${file}: atomic Codex config writer shape changed`);
  }
  let hardened = replaceExactly(
    file,
    fragment,
    `await ${writeFile}(temporaryPath, data);`,
    `await ${writeFile}(temporaryPath, data, { flag: "wx", mode: 0o600 });`,
  );
  hardened = replaceExactly(
    file,
    hardened,
    "  const writeTarget = await resolveSymlinkTarget(targetPath);",
    "  const writeTarget = await validateNoSymlinkPath(targetPath);",
  );
  const resolverStart = hardened.indexOf("async function resolveSymlinkTarget(targetPath) {");
  if (resolverStart === -1) {
    throw new Error(`${file}: symbolic-link resolver is missing`);
  }
  const hardenedResolver = `async function validateNoSymlinkPath(targetPath) {
  const writeTarget = ${resolve}(targetPath);
  for (const current of [${dirname}(writeTarget), writeTarget]) {
    try {
      const stats = await ${lstat}(current);
      if (stats.isSymbolicLink())
        throw new Error(\`Refusing to write Codex config through symbolic link: \${current}\`);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT")
        throw error;
    }
  }
  return writeTarget;
}
`;
  hardened = `${hardened.slice(0, resolverStart)}${hardenedResolver}`;
  source = `${source.slice(0, start)}${hardened}${source.slice(end)}`;
  const installerStart = source.indexOf("async function runCodexInstaller(options = {}) {");
  if (installerStart !== -1) {
    const installer = source.slice(installerStart);
    const codexHomeLine =
      / {2}const codexHome = [A-Za-z0-9_]+\(options\.codexHome \?\? [^\n]+? \?\? (?<join>[A-Za-z0-9_]+)\([^\n]+? "\.codex"\)\);\n/u.exec(
        installer,
      );
    const join = codexHomeLine?.groups?.join;
    if (codexHomeLine?.index === undefined || join === undefined) {
      throw new Error(`${file}: Codex installer home resolution changed`);
    }
    const guard = `${codexHomeLine[0]}  for (const managedEntry of ["config.toml", "plugins", ".tmp", "agents", "runtime", "bin"])
    await validateNoSymlinkPath(${join}(codexHome, managedEntry));
`;
    const lineStart = installerStart + codexHomeLine.index;
    source = `${source.slice(0, lineStart)}${guard}${source.slice(lineStart + codexHomeLine[0].length)}`;
  }
  nodeFs.writeFileSync(file, source);
}

/**
 * @param {string} file
 * @param {string} initialSource
 * @param {CleanupRuntimeBindings} bindings
 * @returns {string}
 */
function hardenCleanupConfig(file, initialSource, bindings) {
  let source = initialSource;
  source = replaceExactly(
    file,
    source,
    `import { lstat as ${bindings.configLstat}, mkdir as ${bindings.configMkdir}, readFile as ${bindings.configReadFile}, writeFile as ${bindings.configWriteFile} } from "node:fs/promises";`,
    `import { constants as codexConfigFsConstants } from "node:fs";\nimport { lstat as ${bindings.configLstat}, mkdir as ${bindings.configMkdir}, open as openCodexConfig, rename as renameCodexConfig, unlink as unlinkCodexConfig, writeFile as ${bindings.configWriteFile} } from "node:fs/promises";`,
  );
  source = replaceExactly(
    file,
    source,
    `    nextConfig = removeTomlSections2(nextConfig, (header) => header === \`marketplaces.\${marketplace}\`);\n`,
    "",
  );
  source = replaceExactly(
    file,
    source,
    `  return pluginKey !== null && pluginKey.endsWith(\`@\${marketplace}\`);`,
    `  return pluginKey === \`omo@\${marketplace}\`;`,
  );
  source = replaceExactly(
    file,
    source,
    `  return hookKey.slice(0, separator).endsWith(\`@\${marketplace}\`);`,
    `  return hookKey.slice(0, separator) === \`omo@\${marketplace}\`;`,
  );
  source = replaceExactly(
    file,
    source,
    `function cleanupCodexLightConfigText(${bindings.configParameter}) {`,
    `function cleanupCodexLightConfigText(${bindings.configParameter}, managedAgentPaths = []) {`,
  );
  source = replaceExactly(
    file,
    source,
    "  nextConfig = removeManagedAgentBlocks(nextConfig);",
    "  nextConfig = removeManagedAgentBlocks(nextConfig, managedAgentPaths);",
  );
  source = replaceRange(
    file,
    source,
    "async function cleanupCodexConfig(configPath, now) {",
    "function removeManagedAgentBlocks",
    `async function readRegularCodexConfig(configPath, codexHome) {
  const pathValidation = await validateManagedPathComponents(codexHome, configPath);
  if (pathValidation !== null)
    throw new Error(\`Refusing unsafe Codex config path: \${pathValidation.reason}\`);
  let entryStats;
  try {
    entryStats = await ${bindings.configLstat}(configPath);
  } catch (error) {
    if (${bindings.nodeErrorCode}(error) === "ENOENT")
      return null;
    throw error;
  }
  if (entryStats.isSymbolicLink() || !entryStats.isFile())
    throw new Error(\`Refusing non-regular Codex config: \${configPath}\`);
  const handle = await openCodexConfig(configPath, codexConfigFsConstants.O_RDONLY | codexConfigFsConstants.O_NOFOLLOW);
  try {
    const openedStats = await handle.stat();
    if (!openedStats.isFile())
      throw new Error(\`Refusing non-regular Codex config: \${configPath}\`);
    return await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
}
async function cleanupCodexConfig(configPath, codexHome, now, managedAgentPaths) {
  const original = await readRegularCodexConfig(configPath, codexHome);
  if (original === null)
    return { changed: false };
  const agentsDir = ${bindings.cleanupJoin}(codexHome, "agents");
  const safeManagedAgentPaths = managedAgentPaths.filter((path7) => isSafeManagedAgentPath(agentsDir, path7));
  const next = cleanupCodexLightConfigText(original, safeManagedAgentPaths);
  if (next === original)
    return { changed: false };
  const backupPath = \`\${configPath}.backup-\${${bindings.formatBackupTimestamp}(now?.() ?? new Date)}\`;
  const temporaryPath = \`\${configPath}.tmp-\${process.pid}-\${Date.now()}\`;
  await ${bindings.configMkdir}(${bindings.configDirectoryName}(configPath), { recursive: true });
  await ${bindings.configWriteFile}(backupPath, original, { flag: "wx", mode: 0o600 });
  await ${bindings.configWriteFile}(temporaryPath, \`\${next.trimEnd()}\\n\`, { flag: "wx", mode: 0o600 });
  try {
    await renameCodexConfig(temporaryPath, configPath);
  } catch (error) {
    await unlinkCodexConfig(temporaryPath).catch(() => {});
    throw error;
  }
  return { changed: true, backupPath };
}
`,
  );
  source = replaceExactly(
    file,
    source,
    "  const configCleanup = await cleanupCodexConfig(configPath, input.now);",
    "  const configCleanup = await cleanupCodexConfig(configPath, codexHome, input.now, agentPaths);",
  );
  source = replaceExactly(
    file,
    source,
    `function removeManagedAgentBlocks(${bindings.managedConfigParameter}) {\n  const managedAgentNames = new Set(${bindings.managedAgentNames});`,
    `function removeManagedAgentBlocks(${bindings.managedConfigParameter}, managedAgentPaths) {
  const manifestAgentNames = managedAgentPaths.map((path7) => path7.split(/[\\\\/]/).pop()).filter((fileName) => fileName?.endsWith(".toml")).map((fileName) => fileName.slice(0, -".toml".length));
  const managedAgentNames = new Set([...${bindings.managedAgentNames}, ...manifestAgentNames]);`,
  );
  return source;
}

/**
 * @param {string} file
 * @param {string} initialSource
 * @param {CleanupRuntimeBindings} bindings
 * @returns {string}
 */
function hardenCleanupStatePaths(file, initialSource, bindings) {
  let source = initialSource;
  source = source.replaceAll(
    `${bindings.safetyResolve}(${bindings.safetyJoin}(codexHome, "plugins", "cache", "sisyphuslabs"))`,
    `${bindings.safetyResolve}(${bindings.safetyJoin}(codexHome, "plugins", "cache", "sisyphuslabs", "omo"))`,
  );
  source = source.replaceAll(
    `${bindings.safetyResolve}(${bindings.safetyJoin}(codexHome, ".tmp", "marketplaces", "sisyphuslabs"))`,
    `${bindings.safetyResolve}(${bindings.safetyJoin}(codexHome, ".tmp", "marketplaces", "sisyphuslabs", "plugins", "omo"))`,
  );
  source = replaceExactly(
    file,
    source,
    `    ${bindings.cleanupJoin}(codexHome, "plugins", "cache", "sisyphuslabs"),\n    ${bindings.cleanupJoin}(codexHome, ".tmp", "marketplaces", "sisyphuslabs"),`,
    `    ${bindings.cleanupJoin}(codexHome, "plugins", "cache", "sisyphuslabs", "omo"),\n    ${bindings.cleanupJoin}(codexHome, ".tmp", "marketplaces", "sisyphuslabs", "plugins", "omo"),`,
  );
  source = replaceExactly(
    file,
    source,
    `async function removeManagedPathBestEffort(${bindings.cleanupPath}, seams) {`,
    `async function validateManagedPathComponents(codexHome, target) {
  const root = ${bindings.cleanupResolve}(codexHome);
  const absoluteTarget = ${bindings.cleanupResolve}(target);
  const relativePath = ${bindings.cleanupRelative}(root, absoluteTarget);
  if (relativePath.startsWith("..") || ${bindings.cleanupIsAbsolute}(relativePath))
    return skipped(target, "outside managed Codex cleanup scope");
  const segments = relativePath.length === 0 ? [] : relativePath.split(/[\\\\/]/);
  let current = root;
  for (const segment of ["", ...segments]) {
    if (segment.length > 0)
      current = ${bindings.cleanupJoin}(current, segment);
    const stats = await ${bindings.maybeLstat}(current);
    if (stats === null)
      return null;
    if (stats.isSymbolicLink())
      return skipped(target, \`symbolic link in managed Codex cleanup path: \${current}\`);
    if (current !== absoluteTarget && !stats.isDirectory())
      return skipped(target, \`non-directory in managed Codex cleanup path: \${current}\`);
  }
  return null;
}
async function removeManagedPathBestEffort(${bindings.cleanupPath}, seams) {`,
  );
  source = replaceExactly(
    file,
    source,
    `  const removedOnFirstAttempt = await attemptRemove(${bindings.cleanupPath});\n  await seams.afterFirstAttempt?.();\n  const removedOnRetry = await attemptRemove(${bindings.cleanupPath});`,
    `  const onDiskSkip = await validateManagedPathComponents(seams.codexHome, ${bindings.cleanupPath});
  if (onDiskSkip !== null) {
    seams.onSkip?.(onDiskSkip);
    return false;
  }
  const removedOnFirstAttempt = await attemptRemove(${bindings.cleanupPath}, seams.codexHome);
  await seams.afterFirstAttempt?.();
  const removedOnRetry = await attemptRemove(${bindings.cleanupPath}, seams.codexHome);`,
  );
  source = replaceExactly(
    file,
    source,
    `async function attemptRemove(${bindings.cleanupPath}) {\n  try {\n    if (await ${bindings.cleanupLstat}(${bindings.cleanupPath}).catch(() => null) === null)\n      return false;`,
    `async function attemptRemove(${bindings.cleanupPath}, codexHome) {
  try {
    if (await validateManagedPathComponents(codexHome, ${bindings.cleanupPath}) !== null)
      return false;
    if (await ${bindings.cleanupLstat}(${bindings.cleanupPath}).catch(() => null) === null)
      return false;`,
  );
  return source;
}

/**
 * @param {string} file
 * @param {string} initialSource
 * @param {CleanupRuntimeBindings} bindings
 * @returns {string}
 */
function hardenCleanupAgentPaths(file, initialSource, bindings) {
  let source = initialSource;
  source = replaceExactly(
    file,
    source,
    "  if (await exists6(versionRoot)) {",
    "  if (await validateManagedPathComponents(codexHome, versionRoot) === null && await exists6(versionRoot)) {",
  );
  source = replaceExactly(
    file,
    source,
    `    for (const ${bindings.cleanupPath} of await readInstalledAgentManifest(manifestPath)) {`,
    `    for (const ${bindings.cleanupPath} of await readInstalledAgentManifest(manifestPath, codexHome)) {`,
  );
  source = replaceRange(
    file,
    source,
    "async function readManagedAgentPathsFromConfig(codexHome, configPath) {",
    "async function readInstalledAgentManifest",
    `async function readManagedAgentPathsFromConfig(codexHome, configPath) {
  const config = await readRegularCodexConfig(configPath, codexHome);
  if (config === null)
    return [];
  return ${bindings.managedAgentNames}.filter((agentName) => config.includes(\`config_file = \${JSON.stringify(\`./agents/\${agentName}.toml\`)}\`)).map((agentName) => ${bindings.cleanupJoin}(codexHome, "agents", \`\${agentName}.toml\`));
}
`,
  );
  source = replaceExactly(
    file,
    source,
    "async function readInstalledAgentManifest(manifestPath) {\n  if (!await exists6(manifestPath))",
    "async function readInstalledAgentManifest(manifestPath, codexHome) {\n  if (await validateManagedPathComponents(codexHome, manifestPath) !== null || !await exists6(manifestPath))",
  );
  source = replaceExactly(
    file,
    source,
    `    const entryStat = await ${bindings.maybeLstat}(${bindings.cleanupPath});`,
    `    const pathValidation = await validateManagedPathComponents(codexHome, ${bindings.cleanupPath});
    if (pathValidation !== null) {
      skipped2.push(${bindings.cleanupPath});
      continue;
    }
    const entryStat = await ${bindings.maybeLstat}(${bindings.cleanupPath});`,
  );
  source = replaceExactly(
    file,
    source,
    `  return ${bindings.managedAgentNames}.some((agentName) => fileName === \`\${agentName}.toml\`);`,
    '  return relativePath === fileName && fileName.endsWith(".toml");',
  );
  return source;
}

/**
 * @param {string} file
 * @returns {void}
 */
function hardenCleanup(file) {
  let source = nodeFs.readFileSync(file, "utf8");
  const bindings = cleanupRuntimeBindings(file, source);
  source = hardenCleanupConfig(file, source, bindings);
  source = hardenCleanupStatePaths(file, source, bindings);
  source = hardenCleanupAgentPaths(file, source, bindings);
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

for (const file of [
  "dist/cli-node/index.js",
  "dist/cli/index.js",
  "packages/omo-codex/scripts/install-dist/install-local.mjs",
  "packages/omo-codex/plugin/components/bootstrap/dist/cli.js",
]) {
  hardenAtomicConfigWriter(joinPath(packageRoot, file));
}
hardenCleanup(joinPath(packageRoot, "dist/cli-node/index.js"));
