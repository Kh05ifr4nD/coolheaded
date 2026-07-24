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
      "deno test --allow-env=FAST_CHECK_SEED,FAST_CHECK_PATH,FAST_CHECK_RUNS tests/ci/changeImpact.ts tests/ci/coverage.ts tests/ci/coveragePolicy.ts tests/ci/pullRequest.ts tests/ci/pullRequestControl.ts tests/ci/pullRequestFailure.ts tests/ci/runtimePermissions.ts tests/ci/updateControl.ts tests/ci/updateDiscovery.ts tests/ci/updateState.ts tests/core/commandRunner.ts tests/core/fastCheck.ts tests/core/version.ts tests/nix/denoDependencies.ts tests/nix/denoSnapshot.ts tests/npm/packageHash.ts tests/npm/platformHash.ts tests/npm/registry.ts tests/pin/packageHashConfig.ts tests/pin/sriHash.ts tests/repo/fileSpecCli.ts tests/repo/pathProperty.ts tests/source/jsonClient.ts tests/source/version.ts tests/update/checksumManifest.ts tests/update/rustPackage.ts tests/update/stateProperty.ts",
    );
    assertEquals(
      tasks["test:integration:env"],
      "env -u GH_TOKEN -u GITHUB_TOKEN $COOLHEADED_DENO test --allow-env=GH_TOKEN,GITHUB_TOKEN tests/source/githubVersion.ts",
    );
    assertEquals(
      tasks["test:integration:net"],
      "deno test --unstable-no-legacy-abort --allow-net=127.0.0.1 tests/source/httpClient.ts",
    );
    assertEquals(
      tasks["test:integration:read"],
      "deno test --allow-read=deno.jsonc,flake.nix,flake/gitHooks.nix,lib/nix/base.nix,lib/ts/system/targets.json tests/ci/taskTopology.ts tests/nix/systems.ts tests/pin/jsonOrder.ts",
    );
    assertEquals(
      tasks["test:integration:write"],
      "env -u GH_TOKEN -u GITHUB_TOKEN $COOLHEADED_DENO test --allow-env=GH_TOKEN,GITHUB_TOKEN --allow-read=$TMPDIR --allow-write=$TMPDIR tests/ci/fileSystemPermissions.ts tests/ci/updatePackage.ts tests/npm/packageHashUpdate.ts tests/npm/tarball.ts tests/update/checksumPackage.ts tests/update/checksumPackageHttp.ts tests/update/deno.ts tests/update/grokBuild.ts tests/update/httpPassThrough.ts tests/update/nixfmt.ts tests/update/ohMyOpenAgent.ts tests/update/oxfmt.ts tests/update/paseo.ts tests/update/qmd.ts tests/update/releaseHash.ts tests/update/uvLock.ts",
    );
    assertEquals(
      tasks["test:integration:repo"],
      "deno test --allow-env=PATH,COOLHEADED_CUE,COOLHEADED_GIT --allow-read=.,$TMPDIR,$COOLHEADED_DENO,$COOLHEADED_CUE,$COOLHEADED_GIT,$COOLHEADED_GIT_DIR --allow-run=$COOLHEADED_DENO,$COOLHEADED_CUE,$COOLHEADED_GIT --allow-write=$TMPDIR tests/repo/fileSpec/*.ts",
    );
    assertEquals(
      tasks["test:integration:update"],
      "deno test --allow-env=COOLHEADED_GIT,GITHUB_OUTPUT --allow-read=$TMPDIR --allow-run=$COOLHEADED_DENO,$COOLHEADED_GIT --allow-write=$TMPDIR tests/ci/denoDependenciesRun.ts tests/ci/flakeInputRun.ts tests/ci/packageRun.ts tests/ci/updateGit.ts tests/ci/updateGitBranch.ts tests/ci/updateRuntime.ts",
    );
    assertEquals(
      tasks["test:integration"],
      "deno task test:integration:env && deno task test:integration:net && deno task test:integration:read && deno task test:integration:write && deno task test:integration:repo && deno task test:integration:update",
    );
    assertEquals(
      tasks["test:runtime"],
      "deno task test:pure --no-check && deno task test:integration:env --no-check && deno task test:integration:net --no-check && deno task test:integration:read --no-check && deno task test:integration:write --no-check && deno task test:integration:repo --no-check && deno task test:integration:update --no-check",
    );
    assertEquals(tasks["test"], "deno task check:types && deno task test:runtime");
    assertEquals(
      tasks["test:coverage"],
      "set -o pipefail && deno task test:pure --no-check --coverage=.coverage/pure --coverage-raw-data-only --clean && deno task test:integration:env --no-check --coverage=.coverage/env --coverage-raw-data-only --clean && deno task test:integration:net --no-check --coverage=.coverage/net --coverage-raw-data-only --clean && deno task test:integration:read --no-check --coverage=.coverage/read --coverage-raw-data-only --clean && deno task test:integration:write --no-check --coverage=.coverage/write --coverage-raw-data-only --clean && deno task test:integration:repo --no-check --coverage=.coverage/repo --coverage-raw-data-only --clean && deno task test:integration:update --no-check --coverage=.coverage/update --coverage-raw-data-only --clean && deno coverage --lcov --exclude='/tests/' .coverage/pure .coverage/env .coverage/net .coverage/read .coverage/write .coverage/repo .coverage/update | $COOLHEADED_DENO run --no-check --allow-env=COOLHEADED_GIT --allow-run=$COOLHEADED_GIT .github/ci/coverage.ts",
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
      ".coverage/net",
      ".coverage/read",
      ".coverage/write",
      ".coverage/repo",
      ".coverage/update",
    ]);
    assertEquals(new Set(coverageTargets).size, runtimeChildren.length);
    assertEquals(coverageCommand.split("--clean").length - 1, runtimeChildren.length);
    assertStringIncludes(
      coverageCommand,
      "deno coverage --lcov --exclude='/tests/' .coverage/pure .coverage/env .coverage/net .coverage/read .coverage/write .coverage/repo .coverage/update | $COOLHEADED_DENO run --no-check --allow-env=COOLHEADED_GIT --allow-run=$COOLHEADED_GIT .github/ci/coverage.ts",
    );

    const gitHooks = await Deno.readTextFile("flake/gitHooks.nix");
    assertStringIncludes(gitHooks, 'denoCheck = denoTaskHook "check"');
    assertStringIncludes(gitHooks, 'denoTest = denoTaskHook "test:runtime"');
  });
});
