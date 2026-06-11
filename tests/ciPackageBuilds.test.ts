import {
  buildMatrix,
  changedPackageNames,
  packagesFromInput,
} from "coolheadedCi/discoverCiPackageBuilds.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import { assertEquals } from "@jsr/std__assert";

describe("CI package build discovery", (): void => {
  it("parses explicit package inputs", (): void => {
    assertEquals(packagesFromInput("specKit codex specKit"), ["codex", "specKit"]);
    assertEquals(packagesFromInput(""), []);
  });

  it("selects touched package directories", (): void => {
    assertEquals(
      changedPackageNames([
        "README.md",
        "packages/specKit/package.nix",
        "packages/specKit/uv.lock",
        "packages/codex/pin.json",
      ]),
      ["codex", "specKit"],
    );
  });

  it("expands package infrastructure changes to the full package set", (): void => {
    assertEquals(changedPackageNames(["flake/packageSet.nix"]), "__all__");
    assertEquals(changedPackageNames(["lib/nix/base.nix"]), "__all__");
    assertEquals(changedPackageNames(["packages/.gitignore"]), "__all__");
  });

  it("builds only packages available on each system", (): void => {
    assertEquals(
      buildMatrix(["linuxOnly", "shared"], {
        "aarch64-darwin": ["shared"],
        "aarch64-linux": ["shared"],
        "x86_64-linux": ["linuxOnly", "shared"],
      }),
      [
        { package: "linuxOnly", runner: "ubuntu-24.04", system: "x86_64-linux" },
        { package: "shared", runner: "ubuntu-24.04", system: "x86_64-linux" },
        { package: "shared", runner: "ubuntu-24.04-arm", system: "aarch64-linux" },
        { package: "shared", runner: "macos-26", system: "aarch64-darwin" },
      ],
    );
  });
});
