import type { HttpClient, JsonClient } from "coolheaded/core/httpClient.ts";
import {
  UpdateError,
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
} from "coolheaded/core/updateScript.ts";
import { fetchHttpClient, fetchJsonClient } from "coolheaded/core/fetchHttpClient.ts";
import { Effect } from "effect";
import type { SriHash } from "coolheaded/pin/sriHash.ts";
import { latestGitHubVersion } from "coolheaded/source/githubVersion.ts";
import { systemRecord } from "coolheaded/system/target.ts";
import { verifiedChecksumAssets } from "coolheaded/update/checksumManifest.ts";
import { writePackageHashConfig } from "coolheaded/pin/json.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
type SupportedSystem = Parameters<Parameters<typeof systemRecord>[0]>[0];
type ChecksumVerificationError = Effect.Effect.Error<ReturnType<typeof verifiedChecksumAssets>>;
type GitHubVersionError = Effect.Effect.Error<ReturnType<typeof latestGitHubVersion>>;
type PackageUpdateError = ChecksumVerificationError | GitHubVersionError | UpdateError;

interface UpdateDependencies {
  readonly httpClient: HttpClient;
  readonly jsonClient: JsonClient;
  readonly pinFilePath: string;
}

const RELEASE_ASSETS = {
  "aarch64-darwin": "entire_darwin_arm64.tar.gz",
  "aarch64-linux": "entire_linux_arm64.tar.gz",
  "x86_64-linux": "entire_linux_amd64.tar.gz",
} as const satisfies Readonly<Record<SupportedSystem, string>>;

function checksumUrl(version: string): string {
  return `https://github.com/entireio/cli/releases/download/v${version}/checksums.txt`;
}

function assetUrls(version: string): Readonly<Record<string, string>> {
  const baseUrl = `https://github.com/entireio/cli/releases/download/v${version}`;
  return Object.fromEntries(
    Object.values(RELEASE_ASSETS).map((asset: string): readonly [string, string] => [
      asset,
      `${baseUrl}/${asset}`,
    ]),
  );
}

function platformHashes(
  hashes: Readonly<Record<string, SriHash>>,
): Effect.Effect<Readonly<Record<SupportedSystem, SriHash>>, UpdateError> {
  return Effect.all(
    systemRecord((system: SupportedSystem): Effect.Effect<SriHash, UpdateError> => {
      const asset = RELEASE_ASSETS[system];
      const hash = hashes[asset];
      return hash === undefined
        ? Effect.fail(new UpdateError(`Missing verified checksum: ${asset}`))
        : Effect.succeed(hash);
    }),
  );
}

function updateProgram(
  args: readonly string[],
  dependencies: Readonly<UpdateDependencies>,
): Effect.Effect<void, PackageUpdateError> {
  return updateNewerPinVersion(
    args,
    (): Effect.Effect<string, GitHubVersionError> =>
      latestGitHubVersion({ owner: "entireio", repo: "cli" }, dependencies.jsonClient),
    dependencies.pinFilePath,
    (version: string): Effect.Effect<void, ChecksumVerificationError | UpdateError> =>
      Effect.flatMap(
        verifiedChecksumAssets(dependencies.httpClient, checksumUrl(version), assetUrls(version)),
        (hashes: Readonly<Record<string, SriHash>>) =>
          Effect.flatMap(platformHashes(hashes), (platformPackageHashes) =>
            writePackageHashConfig(dependencies.pinFilePath, {
              platformPackageHashes,
              version,
            }),
          ),
      ),
  );
}

async function main(
  args: readonly string[],
  dependencies: Readonly<UpdateDependencies>,
): Promise<void> {
  await Effect.runPromise(updateProgram(args, dependencies));
}

function cliProgram(args: readonly string[]): Effect.Effect<void, PackageUpdateError> {
  return updateProgram(args, {
    httpClient: fetchHttpClient,
    jsonClient: fetchJsonClient,
    pinFilePath: PIN_FILE_PATH,
  });
}

runUpdateScript(import.meta.url, cliProgram);

export { main, updateProgram };
export type { PackageUpdateError, UpdateDependencies };
