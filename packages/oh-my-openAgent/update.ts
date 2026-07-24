import {
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
} from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import type { JsonClient } from "coolheaded/core/httpClient.ts";
import { fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { latestNpmVersion } from "coolheaded/source/version.ts";
import { npmPackageHash } from "coolheaded/npm/packageHash.ts";
import { systemRecord } from "coolheaded/system/target.ts";
import { writePinJson } from "coolheaded/pin/json.ts";

const NPM_PACKAGE_NAME = "oh-my-openagent";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type LatestVersionError = Effect.Effect.Error<ReturnType<typeof latestNpmVersion>>;
type PackageHashError = Effect.Effect.Error<ReturnType<typeof npmPackageHash>>;
type SupportedSystem = Parameters<Parameters<typeof systemRecord>[0]>[0];

interface OhMyOpenagentPin {
  readonly packageHash: string;
  readonly platformPackageHashes: Readonly<Record<SupportedSystem, string>>;
  readonly version: string;
}

interface UpdateDependencies {
  readonly jsonClient: JsonClient;
  readonly pinFilePath: string;
}

const PLATFORM_PACKAGES = {
  "aarch64-darwin": "oh-my-openagent-darwin-arm64",
  "aarch64-linux": "oh-my-openagent-linux-arm64",
  "x86_64-linux": "oh-my-openagent-linux-x64",
} as const satisfies Readonly<Record<SupportedSystem, string>>;

function latestVersion(jsonClient: JsonClient): ReturnType<typeof latestNpmVersion> {
  return latestNpmVersion(NPM_PACKAGE_NAME, jsonClient);
}

function packageHash(
  packageName: string,
  version: string,
  jsonClient: JsonClient,
): ReturnType<typeof npmPackageHash> {
  return npmPackageHash(packageName, version, jsonClient);
}

function platformHashes(
  version: string,
  jsonClient: JsonClient,
): Effect.Effect<Readonly<Record<SupportedSystem, string>>, PackageHashError> {
  return Effect.all(
    systemRecord(
      (system: SupportedSystem): ReturnType<typeof npmPackageHash> =>
        packageHash(PLATFORM_PACKAGES[system], version, jsonClient),
    ),
  );
}

function packagePin(
  version: string,
  jsonClient: JsonClient,
): Effect.Effect<OhMyOpenagentPin, PackageHashError> {
  return Effect.all({
    packageHash: packageHash(NPM_PACKAGE_NAME, version, jsonClient),
    platformPackageHashes: platformHashes(version, jsonClient),
    version: Effect.succeed(version),
  });
}

function updateProgram(
  args: readonly string[],
  dependencies: Readonly<UpdateDependencies>,
): ReturnType<typeof updateNewerPinVersion<LatestVersionError, PackageHashError>> {
  return updateNewerPinVersion(
    args,
    (): ReturnType<typeof latestNpmVersion> => latestVersion(dependencies.jsonClient),
    dependencies.pinFilePath,
    (version: string): Effect.Effect<void, PackageHashError> =>
      Effect.flatMap(
        packagePin(version, dependencies.jsonClient),
        (pin): Effect.Effect<void> => writePinJson(dependencies.pinFilePath, pin),
      ),
  );
}

async function main(
  args: readonly string[],
  dependencies: Readonly<UpdateDependencies>,
): Promise<void> {
  await Effect.runPromise(updateProgram(args, dependencies));
}

function cliProgram(
  args: readonly string[],
): ReturnType<typeof updateNewerPinVersion<LatestVersionError, PackageHashError>> {
  return updateProgram(args, { jsonClient: fetchJsonClient, pinFilePath: PIN_FILE_PATH });
}

runUpdateScript(import.meta.url, cliProgram);

export { main, updateProgram };
export type { UpdateDependencies };
