import fs from "node:fs";

/** @type {{ readFileSync(file: string, encoding: "utf8"): string, writeFileSync(file: string, contents: string): void }} */
const nodeFs = fs;
/** @type {unknown} */
const packageRoot = process.env.LAZYCODEX_PACKAGE_ROOT;
if (typeof packageRoot !== "string" || packageRoot.length === 0) {
  throw new Error("missing LAZYCODEX_PACKAGE_ROOT");
}
const file = `${packageRoot}/packages/omo-codex/scripts/install-dist/install-local.mjs`;
let source = nodeFs.readFileSync(file, "utf8");

/** @param {string} value @returns {string} */
function javascriptString(value) {
  return JSON.stringify(value)
    .replaceAll("<", String.raw`\u003c`)
    .replaceAll(">", String.raw`\u003e`)
    .replaceAll("\u2028", String.raw`\u2028`)
    .replaceAll("\u2029", String.raw`\u2029`);
}

/** @param {string} before @param {string} after @returns {void} */
function replaceOnce(before, after) {
  if (source.split(before).length !== 2) {
    throw new Error(`${file}: expected exactly one ${before}`);
  }
  source = source.replace(before, after);
}

replaceOnce(
  'async function maybeRunNpmInstall(cwd, runCommand, env, args = ["install"]) {',
  `async function maybeRunNpmInstall(cwd, runCommand, env, args = ["install"]) {
  if (process.env.LAZYCODEX_AI_NIX_SKIP_CACHE_NPM === "1" && args.includes("--omit=dev")) return;`,
);
replaceOnce(
  "async function maybeRunNpmSyncSkills(cwd, runCommand, env) {",
  `async function maybeRunNpmSyncSkills(cwd, runCommand, env) {
  if (process.env.LAZYCODEX_AI_NIX_SKIP_CACHE_NPM === "1") return;`,
);

replaceOnce(
  "    await copyDirectory(input.sourcePath, tempPath);",
  "    await copyDirectory(input.sourcePath, tempPath);\n    await normalizeNixPluginPermissions(tempPath);",
);
replaceOnce(
  "    await rewriteCachedMcpManifest(tempPath, input.sourcePath);",
  "    await normalizeNixPluginPermissions(tempPath);\n    await rewriteCachedMcpManifest(tempPath, input.sourcePath);",
);
replaceOnce(
  "  await copyBundledMcpRuntimeDists({ pluginRoot: tempPath, sourceRoot: plugin.sourcePath });",
  "  await normalizeNixPluginPermissions(tempPath);\n  await copyBundledMcpRuntimeDists({ pluginRoot: tempPath, sourceRoot: plugin.sourcePath });\n  await normalizeNixPluginPermissions(tempPath);\n  await normalizeNixPluginPermissions(targetPath);",
);
const delegatedFunction = /^function buildDelegatedOmoInvocation\(parsed\) \{[\s\S]*?^\}/gmu;
if ([...source.matchAll(delegatedFunction)].length !== 1) {
  throw new Error("LazyCodex delegated command entrypoint changed");
}
source = source.replace(
  delegatedFunction,
  `function buildDelegatedOmoInvocation(parsed) {
  if (parsed.command === "doctor") return buildLazyCodexDoctorInvocation(parsed.args);
  const args = [${javascriptString(`${packageRoot}/dist/cli-node/index.js`)}, parsed.command];
  if (parsed.command === "cleanup") args.push("--platform=codex", ...parsed.args);
  else if (parsed.command === "install") {
    args.push("--platform=codex");
    if (parsed.noTui) args.push("--no-tui");
    if (parsed.skipAuth) args.push("--skip-auth");
    if (parsed.autonomousPermissions !== false) args.push("--codex-autonomous");
    else args.push("--no-codex-autonomous");
    if (parsed.repoRoot) args.push("--repo-root=" + parsed.repoRoot);
  } else args.push(...parsed.args);
  return { command: process.execPath, args, delegatesToOmo: true };
}`,
);

const updateFunction = /^async function runLazyCodexManualUpdate\(input = \{\}\) \{[\s\S]*?^\}/gmu;
if ([...source.matchAll(updateFunction)].length !== 1) {
  throw new Error("LazyCodex update entrypoint changed");
}
source = source.replace(
  updateFunction,
  `async function runLazyCodexManualUpdate(input = {}) {
  (input.log ?? console.log)("LazyCodex is managed by Nix; update your flake input and rebuild.");
  return 0;
}`,
);

source += `
import { chmod as nixChmod, lstat as nixLstat, readdir as nixReaddir } from "node:fs/promises";
import { join as nixJoin } from "node:path";
async function normalizeNixPluginPermissions(path) {
  let stats;
  try { stats = await nixLstat(path); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  if (stats.isSymbolicLink()) return;
  await nixChmod(path, stats.mode | (stats.isDirectory() ? 0o700 : 0o200));
  if (stats.isDirectory()) {
    for (const entry of await nixReaddir(path))
      await normalizeNixPluginPermissions(nixJoin(path, entry));
  }
}
`;
nodeFs.writeFileSync(file, source);

const commentCheckerFile = `${packageRoot}/packages/omo-codex/plugin/components/comment-checker/dist/cli.js`;
const commentChecker = nodeFs.readFileSync(commentCheckerFile, "utf8");
const resolver = /^function resolveCommentCheckerBinary2\(\) \{[\s\S]*?^\}/gmu;
if ([...commentChecker.matchAll(resolver)].length !== 1) {
  throw new Error("comment-checker binary resolver changed");
}
nodeFs.writeFileSync(
  commentCheckerFile,
  commentChecker.replace(
    resolver,
    `function resolveCommentCheckerBinary2() { return ${javascriptString(`${packageRoot}/runtime/comment-checker`)}; }`,
  ),
);

const manifestFile = `${packageRoot}/packages/omo-codex/plugin/.codex-plugin/plugin.json`;
/** @type {{ hooks: string[] }} */
const manifest = JSON.parse(nodeFs.readFileSync(manifestFile, "utf8"));
manifest.hooks = manifest.hooks.filter((hook) => !hook.includes("checking-auto-update"));
nodeFs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
