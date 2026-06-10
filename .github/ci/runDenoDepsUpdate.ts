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

const DENO_DEPENDENCY_HASH_FILE_PATH = "flake/gitHooks.nix";
const FAKE_HASH = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const LINUX_SYSTEMS = ["aarch64-linux", "x86_64-linux"] as const;

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

function denoDependencyHashSystems(system: string): readonly string[] {
  return system === "aarch64-linux" || system === "x86_64-linux" ? LINUX_SYSTEMS : [system];
}

function escapedRegExpLiteral(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function denoDependencyHashPattern(system: string): RegExp {
  return new RegExp(
    `(?<prefix>${escapedRegExpLiteral(system)} = ")sha256-[A-Za-z0-9+/=]+(?<suffix>";)`,
    "u",
  );
}

function denoDependencyHash(content: string, system: string): string {
  const match = denoDependencyHashPattern(system).exec(content);
  if (match?.[0] === undefined) {
    throw new Error(`Missing Deno dependency hash for ${system}`);
  }

  const hashMatch = /sha256-[A-Za-z0-9+/=]+/u.exec(match[0]);
  if (hashMatch?.[0] === undefined) {
    throw new Error(`Malformed Deno dependency hash for ${system}`);
  }

  return hashMatch[0];
}

function replaceDenoDependencyHash(content: string, system: string, hash: string): string {
  const pattern = denoDependencyHashPattern(system);
  if (!pattern.test(content)) {
    throw new Error(`Missing Deno dependency hash for ${system}`);
  }

  return content.replace(pattern, `$<prefix>${hash}$<suffix>`);
}

function replaceDenoDependencyHashes(
  content: string,
  systems: readonly string[],
  hash: string,
): string {
  let updated = content;
  for (const system of systems) {
    updated = replaceDenoDependencyHash(updated, system, hash);
  }

  return updated;
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

async function buildDenoDependencyHash(system: string): Promise<string> {
  const result = await run(
    ["nix", "build", `.#checks.${system}.pre-commit`, "--no-link", "--print-build-logs"],
    { check: false },
  );
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

async function updateDenoDependencyHash(system: string): Promise<string> {
  const systems = denoDependencyHashSystems(system);
  const original = await Deno.readTextFile(DENO_DEPENDENCY_HASH_FILE_PATH);
  const fake = replaceDenoDependencyHash(original, system, FAKE_HASH);
  const hash = await buildDenoDependencyHashWithFakeHash(system, original, fake);

  await Deno.writeTextFile(
    DENO_DEPENDENCY_HASH_FILE_PATH,
    replaceDenoDependencyHashes(original, systems, hash),
  );

  return `${systems.join(", ")}: ${denoDependencyHash(original, system)} -> ${hash}`;
}

async function runDenoDepsUpdate(): Promise<void> {
  const before = directSpecifierVersions(await readJson("deno.lock"));
  await run(["deno", "install", "--frozen=false"], { capture: false });
  const lockChanged = await gitHasChanges(["deno.lock"]);
  const hashChange = await updateDenoDependencyHash(await currentSystem());

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
  await writeOutput(
    "changelog",
    [versionChanges(before, after), `Deno dependency cache: ${hashChange}`]
      .filter((line: string): boolean => line.length > 0)
      .join("\n"),
  );
}

async function main(): Promise<void> {
  await runDenoDepsUpdate();
}

if (import.meta.main) {
  void main();
}

export {
  DENO_DEPENDENCY_HASH_FILE_PATH,
  denoDependencyHash,
  denoDependencyHashSystems,
  directSpecifierVersions,
  isDenoDependencyHashMismatch,
  parsedNixHash,
  replaceDenoDependencyHash,
  replaceDenoDependencyHashes,
  runDenoDepsUpdate,
  updateDenoDependencyHash,
  versionChanges,
};
