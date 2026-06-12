import {
  commandOutput,
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
  writeTextFile,
} from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import type { PackageHashConfig } from "coolheaded/packageConfigTypes.ts";
import { fetchFromGitHubHash } from "coolheaded/sourceHash.ts";
import { latestNpmVersion } from "coolheaded/latestVersion.ts";
import { npmPackageHashConfig } from "coolheaded/npmPackageUpdater.ts";

const NPM_PACKAGE_NAME = "@mindfoldhq/trellis";
const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);

interface TrellisPin extends PackageHashConfig {
  readonly pnpmDepsHash: string;
  readonly sourceHash: string;
}

function latestVersion(): Effect.Effect<string, Error> {
  return latestNpmVersion(NPM_PACKAGE_NAME);
}

function pnpmDepsHashExpression(version: string, sourceHash: string): string {
  return `
let
  flake = builtins.getFlake "path:${REPOSITORY_ROOT_PATH}";
  pkgs = import flake.inputs.nixpkgs { system = builtins.currentSystem; };
  source = pkgs.fetchFromGitHub {
    owner = "mindfold-ai";
    repo = "Trellis";
    tag = "v${version}";
    hash = "${sourceHash}";
  };
in
pkgs.fetchPnpmDeps {
  pname = "trellis-${version}";
  version = "${version}";
  src = source;
  pnpm = pkgs.pnpm_10;
  pnpmWorkspaces = [ "${NPM_PACKAGE_NAME}..." ];
  pnpmInstallFlags = [ "--prod" ];
  fetcherVersion = 3;
  hash = pkgs.lib.fakeHash;
}
`;
}

function parsePnpmDepsHash(text: string): Effect.Effect<string, Error> {
  const match = /got:\s+(?<pnpmDepsHash>sha256-[A-Za-z0-9+/=]+)/u.exec(text);
  if (match?.groups?.["pnpmDepsHash"] !== undefined) {
    return Effect.succeed(match.groups["pnpmDepsHash"]);
  }

  return Effect.fail(new Error("Failed to parse Trellis pnpmDepsHash"));
}

function parsePnpmDepsHashError(error: Readonly<Error>): Effect.Effect<string, Error> {
  return parsePnpmDepsHash(error.message);
}

function pnpmDepsHash(version: string, sourceHash: string): Effect.Effect<string, Error> {
  return Effect.catchAll(
    Effect.flatMap(
      commandOutput(
        "nix",
        ["build", "--impure", "--no-link", "--expr", pnpmDepsHashExpression(version, sourceHash)],
        REPOSITORY_ROOT_PATH,
      ),
      (): Effect.Effect<string, Error> =>
        Effect.fail(new Error("Unexpected successful Trellis pnpmDepsHash prefetch")),
    ),
    parsePnpmDepsHashError,
  );
}

function serializePin(pin: TrellisPin): string {
  return `${JSON.stringify(
    pin,
    [
      "version",
      "hashes",
      "aarch64-darwin",
      "aarch64-linux",
      "x86_64-linux",
      "sourceHash",
      "pnpmDepsHash",
    ],
    2,
  )}\n`;
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    latestVersion,
    PIN_FILE_PATH,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        Effect.all({
          packageConfig: npmPackageHashConfig(NPM_PACKAGE_NAME, version),
          sourceHash: fetchFromGitHubHash(
            {
              owner: "mindfold-ai",
              repo: "Trellis",
              tag: `v${version}`,
            },
            REPOSITORY_ROOT_PATH,
          ),
        }),
        ({ packageConfig, sourceHash }): Effect.Effect<void, Error> =>
          Effect.flatMap(
            pnpmDepsHash(version, sourceHash),
            (pnpmDepsHashValue: string): Effect.Effect<void> =>
              writeTextFile(
                PIN_FILE_PATH,
                serializePin({
                  ...packageConfig,
                  pnpmDepsHash: pnpmDepsHashValue,
                  sourceHash,
                }),
              ),
          ),
      ),
  );
}

async function main(args: readonly string[]): Promise<void> {
  await Effect.runPromise(updateProgram(args));
}

runUpdateScript(import.meta.url, updateProgram);

export { main };
