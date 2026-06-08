import { requestedOrLatestVersion, runUpdateScript, scriptPath } from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import { latestNpmVersion } from "coolheaded/latestVersion.ts";
import { npmPackageHashConfig } from "coolheaded/npmPackageUpdater.ts";
import { writePackageHashConfig } from "coolheaded/pinJson.ts";

const LAZYCODEX_NPM_PACKAGE_NAME = "lazycodex-ai";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
function latestVersion(): Effect.Effect<string, Error> {
  return latestNpmVersion(LAZYCODEX_NPM_PACKAGE_NAME);
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return Effect.flatMap(
    requestedOrLatestVersion(args, latestVersion),
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        npmPackageHashConfig(LAZYCODEX_NPM_PACKAGE_NAME, version),
        (config): Effect.Effect<void> => writePackageHashConfig(PIN_FILE_PATH, config),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
