import {
  denoRuntime,
  runUpdateScript,
  scriptPath,
  updateNewerPinVersion,
  writeTextFile,
} from "coolheaded/updateScript.ts";
import { Effect } from "effect";
import { fetchFromGitHubHash } from "coolheaded/sourceHash.ts";
import { latestGitHubVersion } from "coolheaded/latestVersion.ts";

const PIN_FILE_PATH = scriptPath("pin.json", import.meta.url);
const REPOSITORY_ROOT_PATH = scriptPath("../../", import.meta.url);

function latestVersion(): Effect.Effect<string, Error> {
  return latestGitHubVersion({
    owner: "astro",
    repo: "deadnix",
  });
}

interface DeadnixPin {
  readonly cargoHash: string;
  readonly hash: string;
  readonly version: string;
}

function cargoHashExpression(version: string, hash: string): string {
  return `
let
  flake = builtins.getFlake "path:${REPOSITORY_ROOT_PATH}";
  pkgs = import flake.inputs.nixpkgs { system = builtins.currentSystem; };
in
pkgs.rustPlatform.buildRustPackage {
  pname = "deadnix";
  version = "${version}";
  src = pkgs.fetchFromGitHub {
    owner = "astro";
    repo = "deadnix";
    tag = "v${version}";
    hash = "${hash}";
  };
  cargoHash = pkgs.lib.fakeHash;
}
`;
}

function parseCargoHash(text: string): Effect.Effect<string, Error> {
  const match = /got:\s+(?<cargoHash>sha256-[A-Za-z0-9+/=]+)/u.exec(text);
  if (match?.groups?.["cargoHash"] !== undefined) {
    return Effect.succeed(match.groups["cargoHash"]);
  }

  return Effect.fail(new Error("Failed to parse deadnix cargoHash"));
}

function cargoHash(version: string, hash: string): Effect.Effect<string, Error> {
  return Effect.tryPromise({
    catch(error: unknown): Error {
      if (error instanceof Error) {
        return error;
      }

      return new Error(String(error));
    },
    async try(): Promise<string> {
      const output = await new (denoRuntime().Command)("nix", {
        args: ["build", "--impure", "--no-link", "--expr", cargoHashExpression(version, hash)],
        cwd: REPOSITORY_ROOT_PATH,
        stderr: "piped",
        stdout: "piped",
      }).output();

      if (output.success) {
        throw new Error("Unexpected successful deadnix cargoHash prefetch");
      }

      return await Effect.runPromise(
        parseCargoHash(new globalThis.TextDecoder().decode(output.stderr)),
      );
    },
  });
}

function serializePin(pin: DeadnixPin): string {
  return `${JSON.stringify(pin, ["version", "hash", "cargoHash"], 2)}\n`;
}

function updateProgram(args: readonly string[]): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    args,
    latestVersion,
    PIN_FILE_PATH,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        fetchFromGitHubHash(
          {
            owner: "astro",
            repo: "deadnix",
            tag: `v${version}`,
          },
          REPOSITORY_ROOT_PATH,
        ),
        (hash: string): Effect.Effect<void, Error> =>
          Effect.flatMap(
            cargoHash(version, hash),
            (cargoHashValue: string): Effect.Effect<void> =>
              writeTextFile(
                PIN_FILE_PATH,
                serializePin({
                  cargoHash: cargoHashValue,
                  hash,
                  version,
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
