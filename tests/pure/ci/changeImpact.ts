import {
  SYSTEM_TARGETS,
  buildMatrix,
  changedActivatedChecks,
  changedDerivationChecks,
  checksFromChangedFiles,
  checksFromInput,
  comparesCheckedOutBase,
  requestedActivatedChecks,
  selectBaselineRevision,
} from "coolheadedCi/impact.ts";
import { assertProperty, defineReplayTarget } from "coolheadedTestSupport/fastCheck.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import type { CommandRequest } from "coolheaded/core/commandRunner.ts";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { SUPPORTED_SYSTEMS } from "coolheaded/system/target.ts";
import { activatedCheckKind } from "coolheadedCi/model.ts";
import { assertEquals } from "@jsr/std__assert";
import fc from "fast-check";

const GIT_REVISION_LENGTH = 40;

function defineInputTests(): void {
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

  it("compares checked-out bases for review and main-branch events", (): void => {
    assertEquals(comparesCheckedOutBase("pull_request"), true);
    assertEquals(comparesCheckedOutBase("merge_group"), true);
    assertEquals(comparesCheckedOutBase("push"), true);
    assertEquals(comparesCheckedOutBase("workflow_dispatch"), false);
    assertEquals(comparesCheckedOutBase(), false);
  });
}

function defineBaselineTests(): void {
  it("uses the push event before as the baseline revision", (): void => {
    const before = "a".repeat(GIT_REVISION_LENGTH);
    assertEquals(selectBaselineRevision("push", before), before);
  });

  it("uses the first parent for pull request baselines", (): void => {
    assertEquals(selectBaselineRevision("pull_request", "b".repeat(GIT_REVISION_LENGTH)), "HEAD^1");
  });

  it("falls back from an all-zero push before", (): void => {
    assertEquals(selectBaselineRevision("push", "0".repeat(GIT_REVISION_LENGTH)), "HEAD^1");
    assertEquals(selectBaselineRevision("push", "invalid"), "HEAD^1");
  });

  it("activates every available check when the baseline cannot resolve", async (): Promise<void> => {
    const baseline = "a".repeat(GIT_REVISION_LENGTH);
    const runner = new FakeCommandRunner([
      {
        assertRequest: ({ command }: CommandRequest): void => {
          assertEquals(command, ["git", "rev-parse", "--verify", `${baseline}^{commit}`]);
        },
        result: { code: 1, stderr: "unknown revision", stdout: "" },
      },
    ]);
    const availableBySystem = Object.fromEntries(
      SYSTEM_TARGETS.map(({ system }) => [system, ["shared"]]),
    );
    const currentDrvPathsBySystem = Object.fromEntries(
      SYSTEM_TARGETS.map(({ system }) => [system, { shared: "/nix/store/current.drv" }]),
    );

    assertEquals(
      await requestedActivatedChecks(
        { before: baseline, name: "push" },
        undefined,
        undefined,
        availableBySystem,
        currentDrvPathsBySystem,
        runner,
      ),
      buildMatrix(["shared"], availableBySystem),
    );
    runner.assertExhausted();
  });

  it("shares the resolved baseline between Nix evaluation and fallback diff", async (): Promise<void> => {
    const baseline = "a".repeat(GIT_REVISION_LENGTH);
    const resolvedBaseline = "resolved-baseline";
    const baselineFlakeRefs: string[] = [];
    const runner = new FakeCommandRunner([
      {
        assertRequest: ({ command }: CommandRequest): void => {
          assertEquals(command, ["git", "rev-parse", "--verify", `${baseline}^{commit}`]);
        },
        result: { code: 0, stderr: "", stdout: `${resolvedBaseline}\n` },
      },
      ...SYSTEM_TARGETS.map(() => ({
        assertRequest: ({ command }: CommandRequest): void => {
          if (command[0] !== "nix") {
            throw new Error(`Expected Nix evaluation, received ${command.join(" ")}`);
          }
          const flakeRef = command.at(3);
          if (flakeRef === undefined) {
            throw new Error("Nix evaluation is missing its flake reference");
          }
          baselineFlakeRefs.push(flakeRef);
        },
        result: { code: 1, stderr: "evaluation failed", stdout: "" },
      })),
      {
        assertRequest: ({ command }: CommandRequest): void => {
          assertEquals(command, ["git", "diff", "--name-only", resolvedBaseline, "HEAD", "--"]);
        },
        result: { code: 0, stderr: "", stdout: ".github/ci/impact.ts\n" },
      },
    ]);
    const availableBySystem = Object.fromEntries(
      SYSTEM_TARGETS.map(({ system }) => [system, ["shared"]]),
    );
    const currentDrvPathsBySystem = Object.fromEntries(
      SYSTEM_TARGETS.map(({ system }) => [system, { shared: "/nix/store/current.drv" }]),
    );

    assertEquals(
      await requestedActivatedChecks(
        { before: baseline, name: "push" },
        undefined,
        undefined,
        availableBySystem,
        currentDrvPathsBySystem,
        runner,
      ),
      [],
    );
    assertEquals(
      baselineFlakeRefs.every((flakeRef: string): boolean =>
        flakeRef.includes(`?rev=${encodeURIComponent(resolvedBaseline)}#checks.`),
      ),
      true,
    );
    assertEquals(
      new Set(
        baselineFlakeRefs.map((flakeRef: string): string => flakeRef.replace(/#checks\..*$/u, "")),
      ).size,
      1,
    );
    runner.assertExhausted();
  });
}

function defineDerivationTests(): void {
  it("classifies denoDependencies as a Deno snapshot", (): void => {
    assertEquals(activatedCheckKind("denoDependencies"), "denoSnapshot");
    assertEquals(activatedCheckKind("deno"), "package");
    assertEquals(activatedCheckKind("minerUFull"), "package");
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
}

function defineChangedFilesTests(): void {
  it("falls back to checks owned by changed packages and home modules", (): void => {
    const available = {
      "aarch64-darwin": [
        "codex",
        "codexHomeModule",
        "minerU",
        "minerUFull",
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
          "layout.cue",
          "homeModules/codex.nix",
          "packages/minerU/package.nix",
          "packages/paseo/check.nix",
          "tests/changeImpact.ts",
        ],
        available,
      ),
      [
        "codex",
        "codexHomeModule",
        "codexMinimal",
        "minerU",
        "minerUFull",
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
}

const MAX_CHECK_IDENTIFIER = 1_000_000;
const checkIdentifiers = fc.uniqueArray(fc.integer({ max: MAX_CHECK_IDENTIFIER, min: 0 }), {
  minLength: 1,
});
describe("CI change impact discovery", (): void => {
  defineInputTests();
  defineBaselineTests();
  defineDerivationTests();
  defineChangedFilesTests();
});

const derivationName = "change impact selects exactly generated changed derivations";
Deno.test(derivationName, (): void => {
  assertProperty(
    defineReplayTarget("tests/pure/ci/changeImpact.ts", derivationName),
    fc.property(
      checkIdentifiers,
      fc.nat(),
      (identifiers: readonly number[], selectedIndex: number): void => {
        const names = identifiers.map((identifier: number): string => `check${identifier}`);
        const changedName = names.at(selectedIndex % names.length);
        if (changedName === undefined) {
          throw new TypeError("Generated check names must not be empty");
        }
        const before = Object.fromEntries(
          names.map((name: string): readonly [string, string] => [name, `/old/${name}`]),
        );
        const after = {
          ...before,
          added: "/new/added",
          [changedName]: `/new/${changedName}`,
        };

        assertEquals(changedDerivationChecks(before, after), ["added", changedName].toSorted());
      },
    ),
  );
});

const pathImpactName = "change impact classifies generated package home and global paths";
Deno.test(pathImpactName, (): void => {
  assertProperty(
    defineReplayTarget("tests/pure/ci/changeImpact.ts", pathImpactName),
    fc.property(fc.stringMatching(/^[a-z][a-z0-9]{0,15}$/u), (prefix: string): void => {
      const owned = [prefix, `${prefix}Full`].toSorted();
      const unrelated = `unrelated-${prefix}`;
      const all = [...owned, unrelated].toSorted();
      const available = {
        "aarch64-darwin": [prefix, `${prefix}Full`, unrelated],
        "aarch64-linux": [`${prefix}Full`, unrelated],
        "x86_64-linux": [prefix, unrelated],
      };

      assertEquals(
        checksFromChangedFiles(
          [`packages/${prefix}/package.nix`, `homeModules/${prefix}.nix`],
          available,
        ),
        owned,
      );
      assertEquals(checksFromChangedFiles([`unknown/${prefix}.nix`], available), all);
      assertEquals(checksFromChangedFiles([`lib/ts/${prefix}.ts`], available), all);
      assertEquals(
        checksFromChangedFiles([`.github/ci/${prefix}.ts`, `tests/ci/${prefix}.ts`], available),
        [],
      );
    }),
  );
});
