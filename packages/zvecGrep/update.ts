import {
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
} from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { latestNpmVersion } from "coolheaded/source/version.ts";
import { npmPackageHash } from "coolheaded/npm/packageHash.ts";
import { packageHashConfig } from "coolheaded/pin/packageHashConfig.ts";
import platforms from "./platforms.json" with { type: "json" };
import { systemRecord } from "coolheaded/system/target.ts";
import { writePackageHashConfig } from "coolheaded/pin/json.ts";

const NPM_PACKAGE_NAME = "@zvec/zvec-grep";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);

type PinError =
  | Effect.Effect.Error<ReturnType<typeof npmPackageHash>>
  | Effect.Effect.Error<ReturnType<typeof packageHashConfig>>;

function updateVersion(version: string): Effect.Effect<void, PinError> {
  const hashes = systemRecord((system): ReturnType<typeof npmPackageHash> =>
    npmPackageHash(platforms[system], version, fetchJsonClient),
  );
  return Effect.all(hashes, { concurrency: "unbounded" }).pipe(
    Effect.flatMap((platformPackageHashes): ReturnType<typeof packageHashConfig> =>
      packageHashConfig({ platformPackageHashes, version }),
    ),
    Effect.flatMap((config): Effect.Effect<void> => writePackageHashConfig(PIN_FILE_PATH, config)),
  );
}

runUpdateScript(import.meta.url, (args) =>
  updateNewerPinVersion(
    args,
    () => latestNpmVersion(NPM_PACKAGE_NAME, fetchJsonClient),
    PIN_FILE_PATH,
    updateVersion,
  ),
);
