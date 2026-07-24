import { NIX_EXPR, discoverPackage, packageUpdates } from "coolheadedCi/update/discover/package.ts";
import { assertEquals, assertInstanceOf, assertThrows } from "@jsr/std__assert";
import { discoverUpdateLanes, discoveryPlan, updateLanes } from "coolheadedCi/update/discover.ts";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { flakeInputUpdates } from "coolheadedCi/update/discover/flakeInput.ts";

const LOCK = {
  nodes: {
    alpha: { locked: { rev: "1234567890" } },
    beta: { locked: {} },
    root: { inputs: { alpha: "alpha", beta: "beta", missing: "missing" } },
  },
};

Deno.test("flake input discovery validates filters and locked revisions", (): void => {
  assertEquals(flakeInputUpdates(LOCK, null), [
    { currentVersion: "12345678", name: "alpha" },
    { currentVersion: "unknown", name: "beta" },
  ]);
  assertEquals(flakeInputUpdates(LOCK, ["missing", "alpha"]), [
    { currentVersion: "12345678", name: "alpha" },
  ]);
  assertEquals(flakeInputUpdates({}, null), []);
});

Deno.test("package discovery validates and sorts evaluated versions", (): void => {
  assertEquals(packageUpdates({ alpha: "1.0.0", ignored: null, zeta: "2.0.0" }), [
    { currentVersion: "1.0.0", name: "alpha" },
    { currentVersion: "2.0.0", name: "zeta" },
  ]);
  const error = assertThrows((): void => {
    packageUpdates([]);
  });
  assertInstanceOf(error, Error);
  assertEquals(error.message, "Invalid package discovery JSON");
});

Deno.test("package discovery sends exact system and filtered Nix requests", async (): Promise<void> => {
  const runner = new FakeCommandRunner([
    {
      request: {
        command: ["nix", "eval", "--impure", "--raw", "--expr", "builtins.currentSystem"],
      },
      result: { code: 0, stderr: "", stdout: "aarch64-darwin" },
    },
    {
      request: {
        command: ["nix", "eval", "--json", "--impure", "--expr", NIX_EXPR],
        env: {
          DISCOVERY_CONFIG: JSON.stringify({
            filter: ["zeta", "alpha"],
            system: "aarch64-darwin",
          }),
        },
      },
      result: { code: 0, stderr: "", stdout: '{"zeta":"2.0.0","alpha":"1.0.0"}' },
    },
  ]);
  assertEquals(await discoverPackage(runner, ["zeta", "alpha"]), [
    { currentVersion: "1.0.0", name: "alpha" },
    { currentVersion: "2.0.0", name: "zeta" },
  ]);
  runner.assertExhausted();
});

Deno.test("discovery plan omits disabled reads and runner actions", async (): Promise<void> => {
  const selection = {
    denoDependencies: false,
    flakeInputNames: ["nixpkgs"],
    flakeInputs: false,
    packageNames: ["codex"],
    packages: false,
  };
  const plan = discoveryPlan(selection);
  assertEquals(plan, []);
  const runner = new FakeCommandRunner([]);
  assertEquals(await discoverUpdateLanes(plan, runner), []);
  runner.assertExhausted();
});

Deno.test("discovery plan preserves package then flake then Deno order", (): void => {
  assertEquals(
    discoveryPlan({
      denoDependencies: true,
      flakeInputNames: ["nixpkgs"],
      flakeInputs: true,
      packageNames: ["codex"],
      packages: true,
    }),
    [
      { kind: "package", names: ["codex"] },
      { kind: "flakeInput", names: ["nixpkgs"] },
      { kind: "denoDependencies" },
    ],
  );
});

Deno.test("update lanes use stable kind and name ordering", (): void => {
  assertEquals(
    updateLanes(
      [
        { currentVersion: "2", name: "zeta" },
        { currentVersion: "1", name: "alpha" },
      ],
      [{ currentVersion: "f", name: "nixpkgs" }],
      true,
    ),
    [
      { currentVersion: "deno.lock", kind: "denoDependencies", name: "denoDependencies" },
      { currentVersion: "f", kind: "flakeInput", name: "nixpkgs" },
      { currentVersion: "1", kind: "package", name: "alpha" },
      { currentVersion: "2", kind: "package", name: "zeta" },
    ],
  );
});
