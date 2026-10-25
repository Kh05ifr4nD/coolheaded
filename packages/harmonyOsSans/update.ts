import {
  UpdateError,
  commandOutput,
  runUpdateScript,
  scriptPath,
} from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { latestGitHubPathCommit } from "coolheaded/source/githubVersion.ts";
import { writePinJson } from "coolheaded/pin/json.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const OWNER = "huawei-fonts";
const REPO = "HarmonyOS-Sans";
const ARCHIVE = "HarmonyOS Sans.zip";
const SRI_HASH_PATTERN = /"hash":"(?<hash>sha256-[A-Za-z0-9+/]+=*)"/u;

runUpdateScript(import.meta.url, (_args, runner) =>
  Effect.gen(function* updateHarmonyOsSans(): Effect.fn.Return<void, Error> {
    const { date, rev } = yield* latestGitHubPathCommit(OWNER, REPO, ARCHIVE, fetchJsonClient);
    const prefetch = yield* commandOutput(runner, "nix", [
      "store",
      "prefetch-file",
      "--json",
      "--name",
      "harmonyOsSans.zip",
      `https://media.githubusercontent.com/media/${OWNER}/${REPO}/${rev}/${encodeURIComponent(ARCHIVE)}`,
    ]);
    const hash = SRI_HASH_PATTERN.exec(prefetch)?.groups?.["hash"];
    if (hash === undefined) {
      return yield* Effect.fail(
        new UpdateError(`Missing hash in nix prefetch output: ${prefetch}`),
      );
    }
    return yield* writePinJson(PIN_FILE_PATH, {
      packageHash: hash,
      rev,
      version: `0-unstable-${date.slice(0, "YYYY-MM-DD".length)}`,
    });
  }),
);
