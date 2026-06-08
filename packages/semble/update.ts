import {
  requestedOrLatestVersion,
  runUpdateScript,
  scriptPath,
  writeTextFile,
} from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import { fetchFromGitHubHash } from "coolheaded/sourceHash.ts";
import { latestGitHubVersion } from "coolheaded/latestVersion.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);
function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: "MinishLab",
    repo: "semble",
  });
}

function serializePin(hash: string, version: string): string {
  return `${JSON.stringify({ hash, version }, ["version", "hash"], 2)}\n`;
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return Effect.flatMap(
    requestedOrLatestVersion(args, latestVersion),
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        fetchFromGitHubHash(
          {
            owner: "MinishLab",
            repo: "semble",
            tag: `v${version}`,
          },
          REPOSITORY_ROOT_PATH,
        ),
        (hash: string): Effect.Effect<void> =>
          writeTextFile(PIN_FILE_PATH, serializePin(hash, version)),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
