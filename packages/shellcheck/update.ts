import { runUpdateScript, scriptPath, updateNewerPinVersion } from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import type { SupportedSystem } from "coolheaded/system.ts";
import { latestGitHubVersion } from "coolheaded/latestVersion.ts";
import { releaseHashConfig } from "coolheaded/releaseUpdater.ts";
import { writePackageHashConfig } from "coolheaded/pinJson.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: "koalaman",
    repo: "shellcheck",
  });
}

const SHELLCHECK_RELEASE_TARGETS = {
  "aarch64-darwin": "darwin.aarch64",
  "aarch64-linux": "linux.aarch64",
  "x86_64-linux": "linux.x86_64",
} as const satisfies Readonly<Record<SupportedSystem, string>>;

function releaseAssetUrl(version: string, target: string): string {
  return `https://github.com/koalaman/shellcheck/releases/download/v${version}/shellcheck-v${version}.${target}.tar.xz`;
}

function releaseAssetUrls(version: string): Readonly<Record<SupportedSystem, string>> {
  return {
    "aarch64-darwin": releaseAssetUrl(version, SHELLCHECK_RELEASE_TARGETS["aarch64-darwin"]),
    "aarch64-linux": releaseAssetUrl(version, SHELLCHECK_RELEASE_TARGETS["aarch64-linux"]),
    "x86_64-linux": releaseAssetUrl(version, SHELLCHECK_RELEASE_TARGETS["x86_64-linux"]),
  };
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    latestVersion,
    PIN_FILE_PATH,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        releaseHashConfig(version, releaseAssetUrls(version), "sha256Digest"),
        (config): Effect.Effect<void> => writePackageHashConfig(PIN_FILE_PATH, config),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
