import {
  UpdateError,
  readTextFile,
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
} from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { latestNpmVersion } from "coolheaded/source/version.ts";
import { npmPackageHashConfig } from "coolheaded/npm/packageHash.ts";
import { parseSriHash } from "coolheaded/pin/sriHash.ts";
import { prepareNpmTarballWorkspace } from "coolheaded/npm/lock.ts";
import { semverVersionScheme } from "coolheaded/core/version.ts";
import { withTemporaryDirectory } from "coolheaded/core/temporaryDirectory.ts";
import { writePinJson } from "coolheaded/pin/json.ts";

const PACKAGE_NAME = "lazycodex-ai";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const COMMENT_CHECKER_PIN_PATH = scriptPath("commentChecker.json", import.meta.url);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function commentCheckerPin(
  contents: string,
): Effect.Effect<{ readonly hash: string; readonly version: string }, Error> {
  return Effect.try({
    catch: (error: unknown): Error =>
      error instanceof Error ? error : new UpdateError("Invalid Comment Checker lock entry"),
    try: () => {
      const lock: unknown = JSON.parse(contents);
      if (!isRecord(lock) || !isRecord(lock["packages"])) {
        throw new UpdateError("Invalid published plugin package lock");
      }
      const entry = lock["packages"]["node_modules/@code-yeongyu/comment-checker"];
      if (
        !isRecord(entry) ||
        typeof entry["version"] !== "string" ||
        !semverVersionScheme.isValid(entry["version"]) ||
        typeof entry["integrity"] !== "string"
      ) {
        throw new UpdateError("Invalid Comment Checker lock entry");
      }
      return { hash: parseSriHash(entry["integrity"]), version: entry["version"] };
    },
  });
}

runUpdateScript(import.meta.url, (args, runner) =>
  updateNewerPinVersion(
    args,
    () => latestNpmVersion(PACKAGE_NAME, fetchJsonClient),
    PIN_FILE_PATH,
    (version) =>
      withTemporaryDirectory((workspacePath) =>
        Effect.gen(function* updateSteps(): Effect.fn.Return<void, Error> {
          yield* prepareNpmTarballWorkspace({
            packageName: PACKAGE_NAME,
            runner,
            tarballBaseName: PACKAGE_NAME,
            version,
            workspacePath,
          });
          const contents = yield* readTextFile(
            `${workspacePath}/packages/omo-codex/plugin/package-lock.json`,
          );
          const dependency = yield* commentCheckerPin(contents);
          const pin = yield* npmPackageHashConfig(PACKAGE_NAME, version, fetchJsonClient);
          yield* writePinJson(COMMENT_CHECKER_PIN_PATH, {
            packageHash: dependency.hash,
            version: dependency.version,
          });
          yield* writePinJson(PIN_FILE_PATH, pin);
        }),
      ),
  ),
);

export { commentCheckerPin };
