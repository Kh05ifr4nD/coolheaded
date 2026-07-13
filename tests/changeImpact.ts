import {
  SYSTEM_TARGETS,
  buildMatrix,
  changedActivatedChecks,
  changedDerivationChecks,
  checksFromChangedFiles,
  checksFromInput,
  comparesCheckedOutBase,
} from "coolheadedCi/impact.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import { SUPPORTED_SYSTEMS } from "coolheaded/system/target.ts";
import { activatedCheckKind } from "coolheadedCi/model.ts";
import { assertEquals } from "@jsr/std__assert";

describe("CI change impact discovery", (): void => {
  it("keeps CI runner targets aligned with supported systems", (): void => {
    assertEquals(
      SYSTEM_TARGETS.map(({ system }) => system).toSorted(),
      [...SUPPORTED_SYSTEMS].toSorted(),
    );
  });

  it("parses explicit check inputs", (): void => {
    assertEquals(checksFromInput("betaPackage alphaPackage betaPackage"), [
      "alphaPackage",
      "betaPackage",
    ]);
    assertEquals(checksFromInput(""), []);
  });

  it("compares checked-out merge bases for protected queue events", (): void => {
    assertEquals(comparesCheckedOutBase("pull_request"), true);
    assertEquals(comparesCheckedOutBase("merge_group"), true);
    assertEquals(comparesCheckedOutBase("workflow_dispatch"), false);
    assertEquals(comparesCheckedOutBase(), false);
  });

  it("classifies denoDependencies as a Deno snapshot", (): void => {
    assertEquals(activatedCheckKind("denoDependencies"), "denoSnapshot");
    assertEquals(activatedCheckKind("deno"), "package");
    assertEquals(activatedCheckKind("minerUWithAll"), "package");
  });

  it("selects checks whose derivation identity changed", (): void => {
    assertEquals(
      changedDerivationChecks(
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
      changedActivatedChecks(
        {
          "aarch64-darwin": {
            denoDependencies: "/nix/store/darwin-deno-snapshot-old.drv",
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
            denoDependencies: "/nix/store/darwin-deno-snapshot-new.drv",
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
          kind: "denoSnapshot",
          name: "denoDependencies",
          runner: "macos-26",
          system: "aarch64-darwin",
        },
        {
          kind: "package",
          name: "linuxOnly",
          runner: "ubuntu-24.04-arm",
          system: "aarch64-linux",
        },
      ],
    );
  });

  it("builds only activated checks available on each system", (): void => {
    assertEquals(
      buildMatrix(["denoDependencies", "linuxOnly", "shared"], {
        "aarch64-darwin": ["shared"],
        "aarch64-linux": ["shared"],
        "x86_64-linux": ["denoDependencies", "linuxOnly", "shared"],
      }),
      [
        { kind: "package", name: "shared", runner: "macos-26", system: "aarch64-darwin" },
        { kind: "package", name: "shared", runner: "ubuntu-24.04-arm", system: "aarch64-linux" },
        {
          kind: "denoSnapshot",
          name: "denoDependencies",
          runner: "ubuntu-24.04",
          system: "x86_64-linux",
        },
        {
          kind: "package",
          name: "linuxOnly",
          runner: "ubuntu-24.04",
          system: "x86_64-linux",
        },
        { kind: "package", name: "shared", runner: "ubuntu-24.04", system: "x86_64-linux" },
      ],
    );
  });

  it("falls back to checks owned by changed packages and home modules", (): void => {
    const available = {
      "aarch64-darwin": [
        "codex",
        "codexHomeModule",
        "openViking",
        "openVikingBot",
        "paseo",
        "paseoHomeModule",
        "unrelated",
      ],
      "aarch64-linux": ["codex", "codexMinimal", "paseo", "unrelated"],
    };

    assertEquals(
      checksFromChangedFiles(
        [
          ".github/ci/impact.ts",
          "fileSpec.cue",
          "homeModules/codex.nix",
          "packages/openViking/package.nix",
          "packages/paseo/check.nix",
          "tests/changeImpact.ts",
        ],
        available,
      ),
      [
        "codex",
        "codexHomeModule",
        "codexMinimal",
        "openViking",
        "openVikingBot",
        "paseo",
        "paseoHomeModule",
      ],
    );
  });

  it("falls back to all checks for shared or unmapped changes", (): void => {
    const available = {
      "aarch64-darwin": ["codex", "paseo"],
      "aarch64-linux": ["codex", "paseo"],
    };

    assertEquals(checksFromChangedFiles(["lib/nix/github.nix"], available), ["codex", "paseo"]);
    assertEquals(checksFromChangedFiles(["packages/missing/package.nix"], available), [
      "codex",
      "paseo",
    ]);
    assertEquals(checksFromChangedFiles([".github/ci/impact.ts"], available), []);
  });
});
