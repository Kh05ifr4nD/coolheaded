import { assertEquals, assertStringIncludes } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import { parse } from "@jsr/std__jsonc";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("Deno task topology", (): void => {
  it("keeps runtime discovery scoped to executable test domains", async (): Promise<void> => {
    const config = parse(await Deno.readTextFile("deno.jsonc"));
    if (!isRecord(config) || !isRecord(config["test"])) {
      throw new TypeError("deno.jsonc does not contain test configuration");
    }

    assertEquals(config["test"]["include"], [
      "tests/ci/**/*.ts",
      "tests/core/**/*.ts",
      "tests/nix/**/*.ts",
      "tests/npm/**/*.ts",
      "tests/pin/**/*.ts",
      "tests/repo/**/*.ts",
      "tests/source/**/*.ts",
      "tests/update/**/*.ts",
    ]);
    assertEquals(config["test"]["exclude"], ["tests/support/**/*.ts", "tests/type/**/*.ts"]);
  });

  it("keeps type, runtime, and coverage ownership explicit", async (): Promise<void> => {
    const config = parse(await Deno.readTextFile("deno.jsonc"));
    if (!isRecord(config) || !isRecord(config["tasks"])) {
      throw new TypeError("deno.jsonc does not contain tasks");
    }

    const { tasks } = config;
    assertEquals(
      tasks["check:types"],
      "deno check .github/ci/**/*.ts packages/*/update.ts lib/ts/**/*.ts tests/**/*.ts",
    );
    assertEquals(tasks["check"], "deno task check:types && deno task check:fileSpec");
    assertEquals(
      tasks["test:pure"],
      "deno test --allow-env=FAST_CHECK_SEED,FAST_CHECK_PATH,FAST_CHECK_RUNS tests/ci/changeImpact.ts tests/ci/pullRequest.ts tests/ci/runtimePermissions.ts tests/core/fastCheck.ts tests/core/version.ts tests/nix/denoDependencies.ts tests/nix/denoSnapshot.ts tests/pin/packageHashConfig.ts tests/pin/sriHash.ts tests/repo/pathProperty.ts tests/update/stateProperty.ts",
    );
    assertEquals(
      tasks["test:integration:env"],
      "deno test --allow-env=GH_TOKEN,GITHUB_TOKEN tests/source/version.ts",
    );
    assertEquals(
      tasks["test:integration:read"],
      "deno test --allow-read=deno.jsonc,flake.nix,flake/gitHooks.nix,lib/nix/base.nix,lib/ts/system/targets.json tests/ci/taskTopology.ts tests/nix/systems.ts tests/pin/jsonOrder.ts",
    );
    assertEquals(
      tasks["test:integration:write"],
      "deno test --allow-read=$TMPDIR --allow-write=$TMPDIR tests/ci/fileSystemPermissions.ts tests/ci/updatePackage.ts tests/npm/packageHash.ts tests/update/releaseHash.ts",
    );
    assertEquals(
      tasks["test:integration:repo"],
      "deno test --allow-env=PATH,COOLHEADED_CUE,COOLHEADED_GIT --allow-read=.,$TMPDIR,$COOLHEADED_DENO,$COOLHEADED_CUE,$COOLHEADED_GIT,$COOLHEADED_GIT_DIR --allow-run=$COOLHEADED_DENO,$COOLHEADED_CUE,$COOLHEADED_GIT --allow-write=$TMPDIR tests/repo/fileSpec/*.ts",
    );
    assertEquals(
      tasks["test:integration"],
      "deno task test:integration:env && deno task test:integration:read && deno task test:integration:write && deno task test:integration:repo",
    );
    assertEquals(
      tasks["test:runtime"],
      "deno task test:pure --no-check && deno task test:integration:env --no-check && deno task test:integration:read --no-check && deno task test:integration:write --no-check && deno task test:integration:repo --no-check",
    );
    assertEquals(tasks["test"], "deno task check:types && deno task test:runtime");
    assertEquals(
      tasks["test:coverage"],
      "deno task test:pure --no-check --coverage=.coverage/pure --coverage-raw-data-only --clean && deno task test:integration:env --no-check --coverage=.coverage/env --coverage-raw-data-only --clean && deno task test:integration:read --no-check --coverage=.coverage/read --coverage-raw-data-only --clean && deno task test:integration:write --no-check --coverage=.coverage/write --coverage-raw-data-only --clean && deno task test:integration:repo --no-check --coverage=.coverage/repo --coverage-raw-data-only --clean && deno coverage .coverage/pure .coverage/env .coverage/read .coverage/write .coverage/repo",
    );

    const runtimeCommand = tasks["test:runtime"];
    const coverageCommand = tasks["test:coverage"];
    if (typeof runtimeCommand !== "string" || typeof coverageCommand !== "string") {
      throw new TypeError("runtime and coverage tasks must be strings");
    }

    const taskName = /deno task test:[^ ]+/gu;
    const runtimeChildren = runtimeCommand.match(taskName) ?? [];
    const coverageChildren = coverageCommand.match(taskName) ?? [];
    assertEquals(coverageChildren, runtimeChildren);
    for (const child of runtimeCommand.split(" && ")) {
      assertStringIncludes(child, "--no-check");
    }

    const coverageTargets = [
      ...coverageCommand.matchAll(/--coverage=(?<target>\.coverage\/[^ ]+)/gu),
    ].map(
      (match: { readonly groups?: Readonly<Record<string, string>> }): string =>
        match.groups?.["target"] ?? "",
    );
    assertEquals(coverageTargets, [
      ".coverage/pure",
      ".coverage/env",
      ".coverage/read",
      ".coverage/write",
      ".coverage/repo",
    ]);
    assertEquals(new Set(coverageTargets).size, runtimeChildren.length);
    assertEquals(coverageCommand.split("--clean").length - 1, runtimeChildren.length);
    assertStringIncludes(
      coverageCommand,
      "deno coverage .coverage/pure .coverage/env .coverage/read .coverage/write .coverage/repo",
    );

    const gitHooks = await Deno.readTextFile("flake/gitHooks.nix");
    assertStringIncludes(gitHooks, 'denoCheck = denoTaskHook "check"');
    assertStringIncludes(gitHooks, 'denoTest = denoTaskHook "test:runtime"');
  });
});
