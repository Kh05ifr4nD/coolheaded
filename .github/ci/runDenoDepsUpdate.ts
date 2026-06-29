#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run --allow-write

import {
  assertOnlyChangedFiles,
  changedFiles,
  currentSystem,
  gitHasChanges,
  isRecord,
  readJson,
  run,
  writeOutput,
} from "./lib.ts";

const DENO_DEPENDENCY_HASH_FILE_PATH = "flake/denoDependencies.nix";
const FAKE_HASH = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function directSpecifierVersions(lock: unknown): Readonly<Record<string, string>> {
  if (!isRecord(lock) || !isRecord(lock["specifiers"])) {
    return {};
  }

  const versions: Record<string, string> = {};
  for (const [specifier, version] of Object.entries(lock["specifiers"])) {
    if (typeof version === "string") {
      versions[specifier] = version;
    }
  }

  return versions;
}

function versionChanges(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): string {
  const changes: string[] = [];
  for (const [specifier, version] of Object.entries(after)) {
    const oldVersion = before[specifier];
    if (oldVersion !== version) {
      changes.push(`${specifier}: ${oldVersion ?? "missing"} -> ${version}`);
    }
  }

  return changes.join("\n");
}

function denoDependencyHashPattern(): RegExp {
  return /(?<prefix>hash = ")sha256-[A-Za-z0-9+/=]+(?<suffix>";)/u;
}

function denoDependencyHash(content: string): string {
  const match = denoDependencyHashPattern().exec(content);
  if (match?.[0] === undefined) {
    throw new Error("Missing Deno dependency hash");
  }

  const hashMatch = /sha256-[A-Za-z0-9+/=]+/u.exec(match[0]);
  if (hashMatch?.[0] === undefined) {
    throw new Error("Malformed Deno dependency hash");
  }

  return hashMatch[0];
}

function replaceDenoDependencyHash(content: string, hash: string): string {
  const pattern = denoDependencyHashPattern();
  if (!pattern.test(content)) {
    throw new Error("Missing Deno dependency hash");
  }

  return content.replace(pattern, `$<prefix>${hash}$<suffix>`);
}

function denoDependencyBuildCommand(system: string): readonly string[] {
  return ["nix", "build", `.#checks.${system}.denoDependencies`, "--no-link", "--print-build-logs"];
}

function parsedNixHash(output: string): string {
  const match = /got:\s+(?<hash>sha256-[A-Za-z0-9+/=]+)/u.exec(output);
  if (match?.groups?.["hash"] === undefined) {
    throw new Error(`Unable to parse Nix fixed-output hash from output:\n${output}`);
  }

  return match.groups["hash"];
}

function isDenoDependencyHashMismatch(output: string): boolean {
  return (
    output.includes("coolheaded-deno-dependencies") && /got:\s+sha256-[A-Za-z0-9+/=]+/u.test(output)
  );
}

async function buildDenoDependencyCheck(
  system: string,
): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> {
  return await run(denoDependencyBuildCommand(system), { check: false });
}

async function buildDenoDependencyHash(system: string): Promise<string> {
  const result = await buildDenoDependencyCheck(system);
  if (result.code === 0) {
    throw new Error("Expected fake Deno dependency hash to fail, but the build succeeded");
  }

  return parsedNixHash(`${result.stdout}\n${result.stderr}`);
}

async function buildDenoDependencyHashWithFakeHash(
  system: string,
  original: string,
  fake: string,
): Promise<string> {
  await Deno.writeTextFile(DENO_DEPENDENCY_HASH_FILE_PATH, fake);
  try {
    return await buildDenoDependencyHash(system);
  } finally {
    await Deno.writeTextFile(DENO_DEPENDENCY_HASH_FILE_PATH, original);
  }
}

async function updateDenoDependencyHash(system: string): Promise<void> {
  const original = await Deno.readTextFile(DENO_DEPENDENCY_HASH_FILE_PATH);
  const fake = replaceDenoDependencyHash(original, FAKE_HASH);
  const hash = await buildDenoDependencyHashWithFakeHash(system, original, fake);

  await Deno.writeTextFile(
    DENO_DEPENDENCY_HASH_FILE_PATH,
    replaceDenoDependencyHash(original, hash),
  );
}

async function runDenoDepsUpdate(): Promise<void> {
  const before = directSpecifierVersions(await readJson("deno.lock"));
  await run(["deno", "install", "--frozen=false"], { capture: false });
  const lockChanged = await gitHasChanges(["deno.lock"]);
  await updateDenoDependencyHash(await currentSystem());

  if (!lockChanged && !(await gitHasChanges([DENO_DEPENDENCY_HASH_FILE_PATH]))) {
    await writeOutput("updated", "false");
    return;
  }

  assertOnlyChangedFiles(
    await changedFiles(),
    (file: string): boolean => file === "deno.lock" || file === DENO_DEPENDENCY_HASH_FILE_PATH,
  );
  const after = directSpecifierVersions(await readJson("deno.lock"));
  await writeOutput("updated", "true");
  await writeOutput("newVersion", "deno dependencies");
  await writeOutput("changelog", versionChanges(before, after));
}

async function main(): Promise<void> {
  await runDenoDepsUpdate();
}

if (import.meta.main) {
  void main();
}

export {
  buildDenoDependencyCheck,
  DENO_DEPENDENCY_HASH_FILE_PATH,
  denoDependencyBuildCommand,
  denoDependencyHash,
  directSpecifierVersions,
  isDenoDependencyHashMismatch,
  parsedNixHash,
  replaceDenoDependencyHash,
  runDenoDepsUpdate,
  updateDenoDependencyHash,
  versionChanges,
};
