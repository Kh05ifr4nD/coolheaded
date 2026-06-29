import {
  denoDependencyBuildCommand,
  denoDependencyHash,
  directSpecifierVersions,
  isDenoDependencyHashMismatch,
  parsedNixHash,
  replaceDenoDependencyHash,
  versionChanges,
} from "coolheadedCi/runDenoDepsUpdate.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import { assertEquals } from "@jsr/std__assert";

describe("Deno deps update helpers", (): void => {
  it("returns direct specifier versions", (): void => {
    assertEquals(
      directSpecifierVersions({
        specifiers: {
          "npm:effect@*": "3.21.2",
        },
      }),
      {
        "npm:effect@*": "3.21.2",
      },
    );
  });

  it("summarizes direct dependency version changes", (): void => {
    assertEquals(
      versionChanges(
        {
          "npm:effect@*": "3.21.2",
          "npm:fast-check@*": "3.23.2",
        },
        {
          "npm:effect@*": "3.21.3",
          "npm:fast-check@*": "3.23.2",
        },
      ),
      "npm:effect@*: 3.21.2 -> 3.21.3",
    );
  });

  it("extracts Deno dependency hashes from the Deno dependency module", (): void => {
    assertEquals(
      denoDependencyHash(
        `
        {
          hash = "sha256-denoDependencies=";
        }
        `,
      ),
      "sha256-denoDependencies=",
    );
  });

  it("replaces the Deno dependency hash", (): void => {
    const content = `
      hash = "sha256-old=";
    `;

    assertEquals(
      replaceDenoDependencyHash(content, "sha256-new="),
      `
      hash = "sha256-new=";
    `,
    );
  });

  it("builds the Deno dependency check directly", (): void => {
    assertEquals(denoDependencyBuildCommand("x86_64-linux"), [
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
    assertEquals(isDenoDependencyHashMismatch(output), true);
    assertEquals(isDenoDependencyHashMismatch("error: hash mismatch in another derivation"), false);
  });
});
