import {
  SYSTEM_TARGETS,
  buildMatrix,
  changedDerivationPackages,
  changedDerivationTargets,
  comparesCheckedOutBase,
  packagesFromInput,
} from "coolheadedCi/discoverCiPackageBuilds.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import { SUPPORTED_SYSTEMS } from "coolheaded/system/target.ts";
import { assertEquals } from "@jsr/std__assert";

describe("CI package build discovery", (): void => {
  it("keeps CI runner targets aligned with supported systems", (): void => {
    assertEquals(
      SYSTEM_TARGETS.map(({ system }) => system).toSorted(),
      [...SUPPORTED_SYSTEMS].toSorted(),
    );
  });

  it("parses explicit package inputs", (): void => {
    assertEquals(packagesFromInput("betaPackage alphaPackage betaPackage"), [
      "alphaPackage",
      "betaPackage",
    ]);
    assertEquals(packagesFromInput(""), []);
  });

  it("compares checked-out merge bases for protected queue events", (): void => {
    assertEquals(comparesCheckedOutBase("pull_request"), true);
    assertEquals(comparesCheckedOutBase("merge_group"), true);
    assertEquals(comparesCheckedOutBase("workflow_dispatch"), false);
    assertEquals(comparesCheckedOutBase(), false);
  });

  it("selects package checks whose derivation identity changed", (): void => {
    assertEquals(
      changedDerivationPackages(
        {
          changed: "/nix/store/source-changed.drv",
          removed: "/nix/store/source-removed.drv",
          unchanged: "/nix/store/source-unchanged.drv",
        },
        {
          added: "/nix/store/target-added.drv",
          changed: "/nix/store/target-changed.drv",
          unchanged: "/nix/store/source-unchanged.drv",
        },
      ),
      ["added", "changed"],
    );
  });

  it("keeps derivation changes scoped to the affected system", (): void => {
    assertEquals(
      changedDerivationTargets(
        {
          "aarch64-darwin": {
            shared: "/nix/store/darwin-shared.drv",
          },
          "aarch64-linux": {
            linuxOnly: "/nix/store/arm-old.drv",
            shared: "/nix/store/arm-shared.drv",
          },
          "x86_64-linux": {
            linuxOnly: "/nix/store/x86-old.drv",
            shared: "/nix/store/x86-shared.drv",
          },
        },
        {
          "aarch64-darwin": {
            shared: "/nix/store/darwin-shared.drv",
          },
          "aarch64-linux": {
            linuxOnly: "/nix/store/arm-new.drv",
            shared: "/nix/store/arm-shared.drv",
          },
          "x86_64-linux": {
            linuxOnly: "/nix/store/x86-old.drv",
            shared: "/nix/store/x86-shared.drv",
          },
        },
      ),
      [
        {
          package: "linuxOnly",
          runner: "ubuntu-24.04-arm",
          system: "aarch64-linux",
        },
      ],
    );
  });

  it("builds only packages available on each system", (): void => {
    assertEquals(
      buildMatrix(["linuxOnly", "shared"], {
        "aarch64-darwin": ["shared"],
        "aarch64-linux": ["shared"],
        "x86_64-linux": ["linuxOnly", "shared"],
      }),
      [
        { package: "shared", runner: "macos-26", system: "aarch64-darwin" },
        { package: "shared", runner: "ubuntu-24.04-arm", system: "aarch64-linux" },
        {
          package: "linuxOnly",
          runner: "ubuntu-24.04",
          system: "x86_64-linux",
        },
        { package: "shared", runner: "ubuntu-24.04", system: "x86_64-linux" },
      ],
    );
  });
});
