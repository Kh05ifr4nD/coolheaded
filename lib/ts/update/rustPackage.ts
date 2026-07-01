import { denoRuntime, updateNewerPinVersion } from "coolheaded/core/updateScript.ts";
import { Effect } from "effect";
import { fetchGitHubSourceHash } from "coolheaded/source/github.ts";
import { writePinJson } from "coolheaded/pin/json.ts";

interface GitHubRustPackage {
  readonly owner: string;
  readonly pname: string;
  readonly repo: string;
  readonly tag: (version: string) => string;
}

interface GitHubRustPackageUpdate {
  readonly args: readonly string[];
  readonly latestVersion: () => Effect.Effect<string, Error>;
  readonly package: GitHubRustPackage;
  readonly pinFilePath: string;
  readonly repositoryRootPath: string;
}

interface RustPackagePin {
  readonly cargoVendorHash: string;
  readonly sourceHash: string;
  readonly version: string;
}

function nixString(value: string): string {
  return JSON.stringify(value);
}

function cargoVendorHashPrefetchExpression(
  source: GitHubRustPackage,
  repositoryRootPath: string,
  version: string,
  hash: string,
): string {
  return `
let
  flake = builtins.getFlake "path:${repositoryRootPath}";
  pkgs = import flake.inputs.nixpkgs { system = builtins.currentSystem; };
in
pkgs.rustPlatform.buildRustPackage {
  pname = ${nixString(source.pname)};
  version = ${nixString(version)};
  src = pkgs.fetchFromGitHub {
    owner = ${nixString(source.owner)};
    repo = ${nixString(source.repo)};
    tag = ${nixString(source.tag(version))};
    hash = ${nixString(hash)};
  };
  cargoHash = pkgs.lib.fakeHash;
}
`;
}

function parseCargoVendorHash(
  packageName: string,
  error: Readonly<Error>,
): Effect.Effect<string, Error> {
  const match = /got:\s+(?<vendorHash>sha256-[A-Za-z0-9+/=]+)/u.exec(error.message);
  if (match?.groups?.["vendorHash"] !== undefined) {
    return Effect.succeed(match.groups["vendorHash"]);
  }

  return Effect.fail(new Error(`Failed to parse ${packageName} cargo vendor hash`));
}

function cargoVendorHash(
  source: GitHubRustPackage,
  repositoryRootPath: string,
  version: string,
  hash: string,
): Effect.Effect<string, Error> {
  return Effect.tryPromise({
    catch(error: unknown): Error {
      return error instanceof Error ? error : new Error(String(error));
    },
    async try(): Promise<string> {
      const output = await new (denoRuntime().Command)("nix", {
        args: [
          "build",
          "--impure",
          "--no-link",
          "--expr",
          cargoVendorHashPrefetchExpression(source, repositoryRootPath, version, hash),
        ],
        cwd: repositoryRootPath,
        stderr: "piped",
        stdout: "piped",
      }).output();

      if (output.success) {
        throw new Error(`Unexpected successful ${source.pname} cargo vendor hash prefetch`);
      }

      const stderr = new globalThis.TextDecoder().decode(output.stderr);
      return await Effect.runPromise(parseCargoVendorHash(source.pname, new Error(stderr)));
    },
  });
}

function updateGitHubRustPackagePin(options: GitHubRustPackageUpdate): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    options.args,
    options.latestVersion,
    options.pinFilePath,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        fetchGitHubSourceHash(options.package, version, options.repositoryRootPath),
        (hash: string): Effect.Effect<void, Error> =>
          Effect.flatMap(
            cargoVendorHash(options.package, options.repositoryRootPath, version, hash),
            (cargoVendorHashValue: string): Effect.Effect<void> =>
              writePinJson(options.pinFilePath, {
                cargoVendorHash: cargoVendorHashValue,
                sourceHash: hash,
                version,
              }),
          ),
      ),
  );
}

export { cargoVendorHash, updateGitHubRustPackagePin };
export type { GitHubRustPackage, GitHubRustPackageUpdate, RustPackagePin };
