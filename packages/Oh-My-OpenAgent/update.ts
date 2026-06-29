import { runUpdateScript, scriptPath, updateNewerPinVersion } from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import type { SupportedSystem } from "coolheaded/system.ts";
import { latestNpmVersion } from "coolheaded/latestVersion.ts";
import { npmPackageHashConfig } from "coolheaded/npmPackageUpdater.ts";
import { writePinJson } from "coolheaded/pinJson.ts";

const NPM_PACKAGE_NAME = "oh-my-openagent";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);

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
  return Effect.map(
    npmPackageHashConfig(packageName, version),
    (config): string => config.platformPackageHashes["aarch64-darwin"],
  );
}

function platformHashes(
  version: string,
): Effect.Effect<Readonly<Record<SupportedSystem, string>>, Error> {
  return Effect.all({
    "aarch64-darwin": packageHash(PLATFORM_PACKAGES["aarch64-darwin"], version),
    "aarch64-linux": packageHash(PLATFORM_PACKAGES["aarch64-linux"], version),
    "x86_64-linux": packageHash(PLATFORM_PACKAGES["x86_64-linux"], version),
  });
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
