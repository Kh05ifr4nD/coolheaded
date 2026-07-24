import {
  denoSnapshotBuildCommand,
  denoSnapshotHash,
  isDenoSnapshotHashMismatch,
  parsedNixHash,
  replaceDenoSnapshotHash,
} from "coolheaded/repo/denoSnapshot.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import { assertEquals } from "@jsr/std__assert";

describe("Deno snapshot helpers", (): void => {
  it("extracts Deno snapshot hashes from the Deno snapshot module", (): void => {
    assertEquals(
      denoSnapshotHash(
        `
        {
          hash = "sha256-denoDependencies=";
        }
        `,
      ),
      "sha256-denoDependencies=",
    );
  });

  it("replaces the Deno snapshot hash", (): void => {
    const content = `
      hash = "sha256-old=";
    `;

    assertEquals(
      replaceDenoSnapshotHash(content, "sha256-new="),
      `
      hash = "sha256-new=";
    `,
    );
  });

  it("builds the Deno snapshot check directly", (): void => {
    assertEquals(denoSnapshotBuildCommand("x86_64-linux"), [
      "nix",
      "build",
      ".#checks.x86_64-linux.denoDependencies",
      "--no-link",
      "--print-build-logs",
    ]);
  });

  it("parses fixed-output hashes from Nix mismatch output", (): void => {
    const output = `
      error: hash mismatch in fixed-output derivation '/nix/store/example-coolheaded-deno-dependencies.drv'
               specified: sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
                    got:    sha256-X6QHXER9IFm04+VKZpAO21iEOckyn9Rkg35knjjM+E8=
    `;

    assertEquals(parsedNixHash(output), "sha256-X6QHXER9IFm04+VKZpAO21iEOckyn9Rkg35knjjM+E8=");
    assertEquals(isDenoSnapshotHashMismatch(output), true);
    assertEquals(isDenoSnapshotHashMismatch("error: hash mismatch in another derivation"), false);
  });
});
