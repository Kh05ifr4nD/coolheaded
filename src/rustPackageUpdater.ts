import { denoRuntime, updateNewerPinVersion, writeTextFile } from "./updateScript.ts";
import { Effect } from "effect";
import { fetchFromGitHubHash } from "./sourceHash.ts";

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
  readonly cargoHash: string;
  readonly hash: string;
  readonly version: string;
}

function nixString(value: string): string {
  return JSON.stringify(value);
}

function cargoHashExpression(
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

function parseCargoHash(packageName: string, error: Readonly<Error>): Effect.Effect<string, Error> {
  const match = /got:\s+(?<cargoHash>sha256-[A-Za-z0-9+/=]+)/u.exec(error.message);
  if (match?.groups?.["cargoHash"] !== undefined) {
    return Effect.succeed(match.groups["cargoHash"]);
  }

  return Effect.fail(new Error(`Failed to parse ${packageName} cargoHash`));
}

function cargoHash(
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
          cargoHashExpression(source, repositoryRootPath, version, hash),
        ],
        cwd: repositoryRootPath,
        stderr: "piped",
        stdout: "piped",
      }).output();

      if (output.success) {
        throw new Error(`Unexpected successful ${source.pname} cargoHash prefetch`);
      }

      const stderr = new globalThis.TextDecoder().decode(output.stderr);
      return await Effect.runPromise(parseCargoHash(source.pname, new Error(stderr)));
    },
  });
}

function serializeRustPackagePin(pin: RustPackagePin): string {
  return `${JSON.stringify(pin, ["version", "hash", "cargoHash"], 2)}\n`;
}

function updateGitHubRustPackagePin(options: GitHubRustPackageUpdate): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    options.args,
    options.latestVersion,
    options.pinFilePath,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        fetchFromGitHubHash(
          {
            owner: options.package.owner,
            repo: options.package.repo,
            tag: options.package.tag(version),
          },
          options.repositoryRootPath,
        ),
        (hash: string): Effect.Effect<void, Error> =>
          Effect.flatMap(
            cargoHash(options.package, options.repositoryRootPath, version, hash),
            (cargoHashValue: string): Effect.Effect<void> =>
              writeTextFile(
                options.pinFilePath,
                serializeRustPackagePin({
                  cargoHash: cargoHashValue,
                  hash,
                  version,
                }),
              ),
          ),
      ),
  );
}

export { cargoHash, updateGitHubRustPackagePin };
export type { GitHubRustPackage, GitHubRustPackageUpdate, RustPackagePin };
