import {
  DENO_SNAPSHOT_HASH_FILE_PATH,
  updateDenoSnapshotHash,
} from "coolheaded/repo/denoSnapshot.ts";
import type { HttpClient, JsonClient } from "coolheaded/core/httpClient.ts";
import {
  commandOutput,
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
} from "coolheaded/core/updateScript.ts";
import { fetchHttpClient, fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { releaseHashConfig, releaseUrlsFromTargets } from "coolheaded/update/release.ts";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";
import { writePackageHashConfig } from "coolheaded/pin/json.ts";

const DENO_RELEASE_VERSION_PREFIX = "v";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type ReleaseTargets = Parameters<typeof releaseUrlsFromTargets>[0];

interface UpdateDependencies {
  readonly denoSnapshotFilePath: string;
  readonly httpClient: HttpClient;
  readonly jsonClient: JsonClient;
  readonly pinFilePath: string;
  readonly runner: CommandRunner;
}

function latestVersion(jsonClient: JsonClient): ReturnType<typeof latestGitHubVersion> {
  return latestGitHubVersion({ owner: "denoland", repo: "deno" }, jsonClient);
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

function updateProgram(
  args: readonly string[],
  dependencies: UpdateDependencies,
): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    (): ReturnType<typeof latestVersion> => latestVersion(dependencies.jsonClient),
    dependencies.pinFilePath,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        releaseHashConfig(
          version,
          releaseUrlsFromTargets(DENO_RELEASE_TARGETS, (target: string): string =>
            sha256SumUrl(version, target),
          ),
          "sha256Sum",
          dependencies.httpClient,
        ),
        (config): Effect.Effect<void, Error> =>
          Effect.zipRight(
            writePackageHashConfig(dependencies.pinFilePath, config),
            Effect.flatMap(
              currentSystem(dependencies.runner),
              (system: string): Effect.Effect<void, Error> =>
                Effect.tryPromise({
                  catch(error: unknown): Error {
                    return error instanceof Error ? error : new Error(String(error));
                  },
                  try: (): Promise<void> =>
                    updateDenoSnapshotHash(
                      system,
                      dependencies.runner,
                      dependencies.denoSnapshotFilePath,
                    ),
                }),
            ),
          ),
      ),
  );
}

async function main(args: readonly string[], dependencies: UpdateDependencies): Promise<void> {
  await Effect.runPromise(updateProgram(args, dependencies));
}

function cliProgram(args: readonly string[], runner: CommandRunner): Effect.Effect<void, Error> {
  return updateProgram(args, {
    denoSnapshotFilePath: DENO_SNAPSHOT_HASH_FILE_PATH,
    httpClient: fetchHttpClient,
    jsonClient: fetchJsonClient,
    pinFilePath: PIN_FILE_PATH,
    runner,
  });
}

runUpdateScript(import.meta.url, cliProgram);

export { main, updateProgram };
export type { UpdateDependencies };
