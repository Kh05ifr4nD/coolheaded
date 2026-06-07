import {
  requestedOrLatestVersion,
  runUpdateScript,
  scriptPath,
} from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import type { SupportedSystem } from "coolheaded/system.ts";
import { latestGitHubVersion } from "coolheaded/latestVersion.ts";
import { releaseHashConfig } from "coolheaded/releaseUpdater.ts";
import { writePackageHashConfig } from "coolheaded/pinJson.ts";

const DENO_RELEASE_VERSION_PREFIX = "v";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
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
} as const satisfies Readonly<Record<SupportedSystem, string>>;

function sha256SumUrl(version: string, target: string): string {
  return `https://dl.deno.land/release/${DENO_RELEASE_VERSION_PREFIX}${version}/deno-${target}.zip.sha256sum`;
}

function sha256SumUrls(
  version: string,
): Readonly<Record<SupportedSystem, string>> {
  return {
    "aarch64-darwin": sha256SumUrl(
      version,
      DENO_RELEASE_TARGETS["aarch64-darwin"],
    ),
    "aarch64-linux": sha256SumUrl(
      version,
      DENO_RELEASE_TARGETS["aarch64-linux"],
    ),
    "x86_64-linux": sha256SumUrl(
      version,
      DENO_RELEASE_TARGETS["x86_64-linux"],
    ),
  };
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return Effect.flatMap(
    requestedOrLatestVersion(args, latestVersion),
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        releaseHashConfig(
          version,
          sha256SumUrls(version),
          "sha256Sum",
        ),
        (config): Effect.Effect<void> =>
          writePackageHashConfig(PIN_FILE_PATH, config),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
