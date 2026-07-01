import { UpdateError, commandOutput, updateNewerPinVersion } from "./updateScript.ts";
import { Effect } from "effect";
import { writePinJson } from "./pinJson.ts";

interface GitHubSource {
  readonly owner: string;
  readonly repo: string;
  readonly tag: string;
}

interface VersionedGitHubSource {
  readonly owner: string;
  readonly repo: string;
  readonly tag: (version: string) => string;
}

interface GitHubSourcePinUpdate {
  readonly args: readonly string[];
  readonly latestVersion: () => Effect.Effect<string, Error>;
  readonly pinFilePath: string;
  readonly repositoryRootPath: string;
  readonly source: VersionedGitHubSource;
}

function unpackedSourceHash(url: string): Effect.Effect<string, Error> {
  return Effect.flatMap(
    commandOutput("nix-prefetch-url", ["--unpack", url]),
    (hash: string): Effect.Effect<string, Error> =>
      commandOutput("nix", ["hash", "convert", "--hash-algo", "sha256", "--to", "sri", hash]),
  );
}

function gitHubTagTarballUrl(source: GitHubSource): string {
  return `https://github.com/${source.owner}/${source.repo}/archive/refs/tags/${source.tag}.tar.gz`;
}

function gitHubSourceVersion(source: VersionedGitHubSource, version: string): GitHubSource {
  return {
    owner: source.owner,
    repo: source.repo,
    tag: source.tag(version),
  };
}

function nixString(value: string): string {
  return JSON.stringify(value);
}

function fetchFromGitHubExpression(source: GitHubSource, repositoryRootPath: string): string {
  return `
let
  flake = builtins.getFlake "path:${repositoryRootPath}";
  pkgs = import flake.inputs.nixpkgs { system = builtins.currentSystem; };
in
pkgs.fetchFromGitHub {
  owner = ${nixString(source.owner)};
  repo = ${nixString(source.repo)};
  tag = ${nixString(source.tag)};
  hash = pkgs.lib.fakeHash;
}
`;
}

function parseHashMismatch(error: Readonly<Error>): Effect.Effect<string, Error> {
  const match = /got:\s+(?<hash>sha256-[A-Za-z0-9+/=]+)/u.exec(error.message);
  if (match?.groups?.["hash"] !== undefined) {
    return Effect.succeed(match.groups["hash"]);
  }

  return Effect.fail(error);
}

function fetchFromGitHubHash(
  source: GitHubSource,
  repositoryRootPath: string,
): Effect.Effect<string, Error> {
  const expression = fetchFromGitHubExpression(source, repositoryRootPath);

  return Effect.catchAll(
    Effect.flatMap(
      commandOutput(
        "nix",
        ["build", "--impure", "--no-link", "--expr", expression],
        repositoryRootPath,
      ),
      (): Effect.Effect<string, Error> =>
        Effect.fail(new UpdateError("Unexpected successful source prefetch")),
    ),
    parseHashMismatch,
  );
}

function fetchGitHubSourceHash(
  source: VersionedGitHubSource,
  version: string,
  repositoryRootPath: string,
): Effect.Effect<string, Error> {
  return fetchFromGitHubHash(gitHubSourceVersion(source, version), repositoryRootPath);
}

function prepareGitHubTagTarballWorkspace(
  source: VersionedGitHubSource,
  workspacePath: string,
  version: string,
): Effect.Effect<void, Error> {
  const archivePath = `${workspacePath}/source.tgz`;
  const versionedSource = gitHubSourceVersion(source, version);
  const download = commandOutput("curl", [
    "-fsSL",
    gitHubTagTarballUrl(versionedSource),
    "-o",
    archivePath,
  ]);
  const extract = commandOutput(
    "tar",
    ["-xzf", archivePath, "--strip-components=1"],
    workspacePath,
  );

  return Effect.zipRight(download, Effect.asVoid(extract));
}

function updateGitHubSourcePin(options: GitHubSourcePinUpdate): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    options.args,
    options.latestVersion,
    options.pinFilePath,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        fetchGitHubSourceHash(options.source, version, options.repositoryRootPath),
        (hash: string): Effect.Effect<void> =>
          writePinJson(options.pinFilePath, {
            sourceHash: hash,
            version,
          }),
      ),
  );
}

export {
  fetchFromGitHubHash,
  fetchGitHubSourceHash,
  gitHubTagTarballUrl,
  gitHubSourceVersion,
  prepareGitHubTagTarballWorkspace,
  unpackedSourceHash,
  updateGitHubSourcePin,
};
export type { GitHubSource, GitHubSourcePinUpdate, VersionedGitHubSource };
