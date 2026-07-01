import {
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
} from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import { latestNpmVersion } from "coolheaded/sources/latestVersion.ts";
import { npmPackageHash } from "coolheaded/npm/packageHashes.ts";
import { systemRecord } from "coolheaded/systems/supported.ts";
import { writePinJson } from "coolheaded/pins/json.ts";

const NPM_PACKAGE_NAME = "oh-my-openagent";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type SupportedSystem = Parameters<Parameters<typeof systemRecord>[0]>[0];

interface OhMyOpenagentPin {
  readonly packageHash: string;
  readonly platformPackageHashes: Readonly<Record<SupportedSystem, string>>;
  readonly version: string;
}

const PLATFORM_PACKAGES = {
  "aarch64-darwin": "oh-my-openagent-darwin-arm64",
  "aarch64-linux": "oh-my-openagent-linux-arm64",
  "x86_64-linux": "oh-my-openagent-linux-x64",
} as const satisfies Readonly<Record<SupportedSystem, string>>;

function latestVersion(): Effect.Effect<string, Error> {
  return latestNpmVersion(NPM_PACKAGE_NAME);
}

function packageHash(packageName: string, version: string): Effect.Effect<string, Error> {
  return npmPackageHash(packageName, version);
}

function platformHashes(
  version: string,
): Effect.Effect<Readonly<Record<SupportedSystem, string>>, Error> {
  return Effect.all(
    systemRecord(
      (system: SupportedSystem): Effect.Effect<string, Error> =>
        packageHash(PLATFORM_PACKAGES[system], version),
    ),
  );
}

function packagePin(version: string): Effect.Effect<OhMyOpenagentPin, Error> {
  return Effect.all({
    packageHash: packageHash(NPM_PACKAGE_NAME, version),
    platformPackageHashes: platformHashes(version),
    version: Effect.succeed(version),
  });
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    latestVersion,
    PIN_FILE_PATH,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        packagePin(version),
        (pin): Effect.Effect<void> => writePinJson(PIN_FILE_PATH, pin),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
