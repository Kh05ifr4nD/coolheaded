import {
  commandOutput,
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
} from "coolheaded/core/updateScript.ts";
import { releaseHashConfig, releaseUrlsFromTargets } from "coolheaded/update/release.ts";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import { latestGitHubVersion } from "coolheaded/source/version.ts";
import { updateDenoSnapshotHash } from "coolheaded/repo/denoSnapshot.ts";
import { writePackageHashConfig } from "coolheaded/pin/json.ts";

const DENO_RELEASE_VERSION_PREFIX = "v";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: "denoland",
    repo: "deno",
  });
}

const DENO_RELEASE_TARGETS = {
  "aarch64-darwin": "aarch64-apple-darwin",
  "aarch64-linux": "aarch64-unknown-linux-gnu",
  "x86_64-linux": "x86_64-unknown-linux-gnu",
} as const satisfies ReleaseTargets;

function sha256SumUrl(version: string, target: string): string {
  return `https://dl.deno.land/release/${DENO_RELEASE_VERSION_PREFIX}${version}/deno-${target}.zip.sha256sum`;
}

function currentSystem(runner: CommandRunner): Effect.Effect<string, Error> {
  return commandOutput(runner, "nix", [
    "eval",
    "--impure",
    "--raw",
    "--expr",
    "builtins.currentSystem",
  ]);
}

function updateProgram(args: readonly string[], runner: CommandRunner): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    latestVersion,
    PIN_FILE_PATH,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        releaseHashConfig(
          version,
          releaseUrlsFromTargets(DENO_RELEASE_TARGETS, (target: string): string =>
            sha256SumUrl(version, target),
          ),
          "sha256Sum",
        ),
        (config): Effect.Effect<void, Error> =>
          Effect.zipRight(
            writePackageHashConfig(PIN_FILE_PATH, config),
            Effect.flatMap(
              currentSystem(runner),
              (system: string): Effect.Effect<void, Error> =>
                Effect.tryPromise({
                  catch(error: unknown): Error {
                    return error instanceof Error ? error : new Error(String(error));
                  },
                  try: (): Promise<void> => updateDenoSnapshotHash(system, runner),
                }),
            ),
          ),
      ),
  );
}

async function main(args: readonly string[], runner: CommandRunner): Promise<void> {
  await Effect.runPromise(updateProgram(args, runner));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
