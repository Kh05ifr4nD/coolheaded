import { requestedOrLatestVersion, runUpdateScript, scriptPath } from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import type { SupportedSystem } from "coolheaded/system.ts";
import { latestNpmVersion } from "coolheaded/latestVersion.ts";
import { npmPlatformPackageHashConfig } from "coolheaded/npmPackageUpdater.ts";
import { writePackageHashConfig } from "coolheaded/pinJson.ts";

const CODEX_NPM_PACKAGE_NAME = "@openai/codex";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const CODEX_PLATFORM_SUFFIXES = {
  "aarch64-darwin": "darwin-arm64",
  "aarch64-linux": "linux-arm64",
  "x86_64-linux": "linux-x64",
} as const satisfies Readonly<Record<SupportedSystem, string>>;

function latestVersion(): Effect.Effect<string, Error> {
  return latestNpmVersion(CODEX_NPM_PACKAGE_NAME);
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return Effect.flatMap(
    requestedOrLatestVersion(args, latestVersion),
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        npmPlatformPackageHashConfig(CODEX_NPM_PACKAGE_NAME, version, CODEX_PLATFORM_SUFFIXES),
        (config): Effect.Effect<void> => writePackageHashConfig(PIN_FILE_PATH, config),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
