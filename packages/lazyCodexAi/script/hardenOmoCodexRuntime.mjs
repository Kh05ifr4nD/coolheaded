import fs from "node:fs";

/**
 * @typedef {{
 *   readFileSync(file: string, encoding: "utf8"): string,
 *   writeFileSync(file: string, contents: string): void,
 * }} FileSystem
 * @typedef {{ readonly env: Readonly<Record<string, string | undefined>> }} NodeProcess
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
 * @returns {string}
 */
function hardenCleanupConfig(file, initialSource) {
  let source = initialSource;
  source = replaceExactly(
    file,
    source,
    'import { lstat as lstat12, mkdir as mkdir8, readFile as readFile21, writeFile as writeFile12 } from "node:fs/promises";',
    'import { constants as codexConfigFsConstants } from "node:fs";\nimport { lstat as lstat12, mkdir as mkdir8, open as openCodexConfig, rename as renameCodexConfig, unlink as unlinkCodexConfig, writeFile as writeFile12 } from "node:fs/promises";',
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
    "function cleanupCodexLightConfigText(config) {",
    "function cleanupCodexLightConfigText(config, managedAgentPaths = []) {",
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
    entryStats = await lstat12(configPath);
  } catch (error) {
    if (nodeErrorCode5(error) === "ENOENT")
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
  const agentsDir = join57(codexHome, "agents");
  const safeManagedAgentPaths = managedAgentPaths.filter((path7) => isSafeManagedAgentPath(agentsDir, path7));
  const next = cleanupCodexLightConfigText(original, safeManagedAgentPaths);
  if (next === original)
    return { changed: false };
  const backupPath = \`\${configPath}.backup-\${formatBackupTimestamp2(now?.() ?? new Date)}\`;
  const temporaryPath = \`\${configPath}.tmp-\${process.pid}-\${Date.now()}\`;
  await mkdir8(dirname19(configPath), { recursive: true });
  await writeFile12(backupPath, original, { flag: "wx", mode: 0o600 });
  await writeFile12(temporaryPath, \`\${next.trimEnd()}\\n\`, { flag: "wx", mode: 0o600 });
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
    "function removeManagedAgentBlocks(config) {\n  const managedAgentNames = new Set(MANAGED_CODEX_AGENT_NAMES2);",
    `function removeManagedAgentBlocks(config, managedAgentPaths) {
  const manifestAgentNames = managedAgentPaths.map((path7) => path7.split(/[\\\\/]/).pop()).filter((fileName) => fileName?.endsWith(".toml")).map((fileName) => fileName.slice(0, -".toml".length));
  const managedAgentNames = new Set([...MANAGED_CODEX_AGENT_NAMES2, ...manifestAgentNames]);`,
  );
  return source;
}

/**
 * @param {string} file
 * @param {string} initialSource
 * @returns {string}
 */
function hardenCleanupStatePaths(file, initialSource) {
  let source = initialSource;
  source = source.replaceAll(
    'resolve16(join56(codexHome, "plugins", "cache", "sisyphuslabs"))',
    'resolve16(join56(codexHome, "plugins", "cache", "sisyphuslabs", "omo"))',
  );
  source = source.replaceAll(
    'resolve16(join56(codexHome, ".tmp", "marketplaces", "sisyphuslabs"))',
    'resolve16(join56(codexHome, ".tmp", "marketplaces", "sisyphuslabs", "plugins", "omo"))',
  );
  source = replaceExactly(
    file,
    source,
    '    join57(codexHome, "plugins", "cache", "sisyphuslabs"),\n    join57(codexHome, ".tmp", "marketplaces", "sisyphuslabs"),',
    '    join57(codexHome, "plugins", "cache", "sisyphuslabs", "omo"),\n    join57(codexHome, ".tmp", "marketplaces", "sisyphuslabs", "plugins", "omo"),',
  );
  source = replaceExactly(
    file,
    source,
    "async function removeManagedPathBestEffort(path7, seams) {",
    `async function validateManagedPathComponents(codexHome, target) {
  const root = resolve17(codexHome);
  const absoluteTarget = resolve17(target);
  const relativePath = relative7(root, absoluteTarget);
  if (relativePath.startsWith("..") || isAbsolute11(relativePath))
    return skipped(target, "outside managed Codex cleanup scope");
  const segments = relativePath.length === 0 ? [] : relativePath.split(/[\\\\/]/);
  let current = root;
  for (const segment of ["", ...segments]) {
    if (segment.length > 0)
      current = join57(current, segment);
    const stats = await maybeLstat2(current);
    if (stats === null)
      return null;
    if (stats.isSymbolicLink())
      return skipped(target, \`symbolic link in managed Codex cleanup path: \${current}\`);
    if (current !== absoluteTarget && !stats.isDirectory())
      return skipped(target, \`non-directory in managed Codex cleanup path: \${current}\`);
  }
  return null;
}
async function removeManagedPathBestEffort(path7, seams) {`,
  );
  source = replaceExactly(
    file,
    source,
    "  const removedOnFirstAttempt = await attemptRemove(path7);\n  await seams.afterFirstAttempt?.();\n  const removedOnRetry = await attemptRemove(path7);",
    `  const onDiskSkip = await validateManagedPathComponents(seams.codexHome, path7);
  if (onDiskSkip !== null) {
    seams.onSkip?.(onDiskSkip);
    return false;
  }
  const removedOnFirstAttempt = await attemptRemove(path7, seams.codexHome);
  await seams.afterFirstAttempt?.();
  const removedOnRetry = await attemptRemove(path7, seams.codexHome);`,
  );
  source = replaceExactly(
    file,
    source,
    "async function attemptRemove(path7) {\n  try {\n    if (await lstat13(path7).catch(() => null) === null)\n      return false;",
    `async function attemptRemove(path7, codexHome) {
  try {
    if (await validateManagedPathComponents(codexHome, path7) !== null)
      return false;
    if (await lstat13(path7).catch(() => null) === null)
      return false;`,
  );
  return source;
}

/**
 * @param {string} file
 * @param {string} initialSource
 * @returns {string}
 */
function hardenCleanupAgentPaths(file, initialSource) {
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
    "    for (const path7 of await readInstalledAgentManifest(manifestPath)) {",
    "    for (const path7 of await readInstalledAgentManifest(manifestPath, codexHome)) {",
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
  return MANAGED_CODEX_AGENT_NAMES2.filter((agentName) => config.includes(\`config_file = \${JSON.stringify(\`./agents/\${agentName}.toml\`)}\`)).map((agentName) => join57(codexHome, "agents", \`\${agentName}.toml\`));
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
    "    const entryStat = await maybeLstat2(path7);",
    `    const pathValidation = await validateManagedPathComponents(codexHome, path7);
    if (pathValidation !== null) {
      skipped2.push(path7);
      continue;
    }
    const entryStat = await maybeLstat2(path7);`,
  );
  source = replaceExactly(
    file,
    source,
    `  return MANAGED_CODEX_AGENT_NAMES2.some((agentName) => fileName === \`\${agentName}.toml\`);`,
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
  source = hardenCleanupConfig(file, source);
  source = hardenCleanupStatePaths(file, source);
  source = hardenCleanupAgentPaths(file, source);
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
