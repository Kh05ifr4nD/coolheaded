import { UpdateError, commandOutput } from "./updateScript.ts";
import { Effect } from "effect";

interface GitHubSource {
  readonly owner: string;
  readonly repo: string;
  readonly tag: string;
}

function unpackedSourceHash(url: string): Effect.Effect<string, Error> {
  return Effect.flatMap(
    commandOutput("nix-prefetch-url", ["--unpack", url]),
    (hash: string): Effect.Effect<string, Error> =>
      commandOutput("nix", ["hash", "convert", "--hash-algo", "sha256", "--to", "sri", hash]),
  );
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
  return Effect.catchAll(
    Effect.flatMap(
      commandOutput(
        "nix",
        [
          "build",
          "--impure",
          "--no-link",
          "--expr",
          fetchFromGitHubExpression(source, repositoryRootPath),
        ],
        repositoryRootPath,
      ),
      (): Effect.Effect<string, Error> =>
        Effect.fail(new UpdateError("Unexpected successful source prefetch")),
    ),
    parseHashMismatch,
  );
}

export { fetchFromGitHubHash, unpackedSourceHash };
export type { GitHubSource };
