import { Effect } from "effect";
import { commandOutput } from "./updateScript.ts";

function unpackedSourceHash(url: string): Effect.Effect<string, Error> {
  return Effect.flatMap(
    commandOutput("nix-prefetch-url", ["--unpack", url]),
    (hash: string): Effect.Effect<string, Error> =>
      commandOutput("nix", [
        "hash",
        "convert",
        "--hash-algo",
        "sha256",
        "--to",
        "sri",
        hash,
      ]),
  );
}

export { unpackedSourceHash };
