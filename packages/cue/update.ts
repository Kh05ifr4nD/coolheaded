import { releaseHashConfig, releaseUrlsFromTargets } from "coolheaded/releaseUpdater.ts";
import { runUpdateScript, scriptPath, updateNewerPinVersion } from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import { latestGitHubVersion } from "coolheaded/latestVersion.ts";
import { writePackageHashConfig } from "coolheaded/pinJson.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

const CUE_RELEASE_TARGETS = {
  "aarch64-darwin": "darwin_arm64",
  "aarch64-linux": "linux_arm64",
  "x86_64-linux": "linux_amd64",
} as const satisfies ReleaseTargets;

function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: "cue-lang",
    repo: "cue",
  });
}

function releaseAssetUrl(version: string, target: string): string {
  return `https://github.com/cue-lang/cue/releases/download/v${version}/cue_v${version}_${target}.tar.gz`;
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    latestVersion,
    PIN_FILE_PATH,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        releaseHashConfig(
          version,
          releaseUrlsFromTargets(CUE_RELEASE_TARGETS, (target: string): string =>
            releaseAssetUrl(version, target),
          ),
          "sha256Digest",
        ),
        (config): Effect.Effect<void> => writePackageHashConfig(PIN_FILE_PATH, config),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
