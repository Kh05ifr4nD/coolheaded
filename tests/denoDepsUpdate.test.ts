import {
  denoDependencyHash,
  denoDependencyHashSystems,
  directSpecifierVersions,
  isDenoDependencyHashMismatch,
  parsedNixHash,
  replaceDenoDependencyHash,
  replaceDenoDependencyHashes,
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
          hashes = {
            aarch64-darwin = "sha256-darwin=";
          };
        }
        `,
        "aarch64-darwin",
      ),
      "sha256-darwin=",
    );
  });

  it("replaces Deno dependency hashes for one or more systems", (): void => {
    const content = `
      aarch64-darwin = "sha256-oldDarwin=";
      aarch64-linux = "sha256-oldLinux=";
      x86_64-linux = "sha256-oldLinux=";
    `;

    assertEquals(
      replaceDenoDependencyHash(content, "aarch64-darwin", "sha256-newDarwin="),
      `
      aarch64-darwin = "sha256-newDarwin=";
      aarch64-linux = "sha256-oldLinux=";
      x86_64-linux = "sha256-oldLinux=";
    `,
    );
    assertEquals(
      replaceDenoDependencyHashes(
        content,
        denoDependencyHashSystems("x86_64-linux"),
        "sha256-newLinux=",
      ),
      `
      aarch64-darwin = "sha256-oldDarwin=";
      aarch64-linux = "sha256-newLinux=";
      x86_64-linux = "sha256-newLinux=";
    `,
    );
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
