import {
  classicProtectionHasRequiredChecks,
  createOrUpdatePullRequest,
  parseConfig,
  rulesetHasRequiredChecks,
} from "coolheadedCi/update/pullRequest.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { assertEquals } from "@jsr/std__assert";

const success = { code: 0, stderr: "", stdout: "" };

describe("update pull request config", (): void => {
  it("defaults to automated dependency labels and auto-merge", (): void => {
    assertEquals(
      parseConfig([
        "--branch",
        "update/package/examplePackage",
        "--title",
        "examplePackage: 1.0.0 -> 1.0.1",
      ]),
      {
        autoMerge: true,
        body: "",
        branch: "update/package/examplePackage",
        dryRun: false,
        labels: ["dependencies", "automated"],
        title: "examplePackage: 1.0.0 -> 1.0.1",
      },
    );
  });

  it("parses explicit labels, body, dry-run, and disabled auto-merge", (): void => {
    assertEquals(
      parseConfig([
        "--branch",
        "update/denoDependencies",
        "--title",
        "deno.lock: update Deno dependencies",
        "--body",
        "effect: 1 -> 2",
        "--labels",
        "dependencies,automated,denoDependencies",
        "--auto-merge",
        "false",
        "--dry-run",
      ]),
      {
        autoMerge: false,
        body: "effect: 1 -> 2",
        branch: "update/denoDependencies",
        dryRun: true,
        labels: ["dependencies", "automated", "denoDependencies"],
        title: "deno.lock: update Deno dependencies",
      },
    );
  });
});

describe("update pull request auto-merge gates", (): void => {
  it("recognizes classic required status checks", (): void => {
    assertEquals(classicProtectionHasRequiredChecks({ contexts: ["CI / check"] }), true);
    assertEquals(classicProtectionHasRequiredChecks({ checks: [{ context: "CI / check" }] }), true);
    assertEquals(classicProtectionHasRequiredChecks({ checks: [], contexts: [] }), false);
  });

  it("recognizes active rulesets with required status checks for main", (): void => {
    assertEquals(
      rulesetHasRequiredChecks(
        {
          conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
          enforcement: "active",
          rules: [
            {
              parameters: {
                required_status_checks: [{ context: "CI / check" }],
              },
              type: "required_status_checks",
            },
          ],
          target: "branch",
        },
        "main",
      ),
      true,
    );
  });

  it("rejects rulesets without concrete required status checks", (): void => {
    assertEquals(
      rulesetHasRequiredChecks(
        {
          enforcement: "active",
          rules: [{ parameters: { required_status_checks: [] }, type: "required_status_checks" }],
          target: "branch",
        },
        "main",
      ),
      false,
    );
  });
});

describe("update pull request command order", (): void => {
  it("stages, commits, pushes, labels, and creates with exact arguments", async (): Promise<void> => {
    const config = {
      autoMerge: false,
      body: "body",
      branch: "update/package/example",
      dryRun: false,
      labels: ["package"],
      title: "example: 1.0.0 -> 1.0.1",
    };
    const runner = new FakeCommandRunner([
      { request: { command: ["git", "add", "--update"] }, result: success },
      {
        request: { command: ["git", "diff", "--cached", "--quiet"] },
        result: { code: 1, stderr: "", stdout: "" },
      },
      {
        request: {
          command: ["git", "commit", "--signoff", "-m", config.title, "-m", config.body],
        },
        result: success,
      },
      {
        request: {
          command: ["git", "push", "--force-with-lease", "origin", `HEAD:${config.branch}`],
        },
        result: success,
      },
      {
        request: {
          command: [
            "gh",
            "pr",
            "list",
            "--head",
            config.branch,
            "--json",
            "number",
            "--jq",
            ".[0].number // empty",
          ],
        },
        result: success,
      },
      {
        request: {
          command: [
            "gh",
            "label",
            "create",
            "package",
            "--color",
            "0e8a16",
            "--description",
            "Managed by update automation",
            "--force",
          ],
        },
        result: success,
      },
      {
        request: {
          command: [
            "gh",
            "pr",
            "create",
            "--base",
            "main",
            "--head",
            config.branch,
            "--title",
            config.title,
            "--body",
            config.body,
            "--label",
            "package",
          ],
        },
        result: success,
      },
      {
        request: {
          command: [
            "gh",
            "pr",
            "list",
            "--head",
            config.branch,
            "--json",
            "number",
            "--jq",
            ".[0].number // empty",
          ],
        },
        result: { code: 0, stderr: "", stdout: "42" },
      },
    ]);

    await createOrUpdatePullRequest(config, runner);
    assertEquals(
      runner.calls().map((request): string => request.command[0]),
      ["git", "git", "git", "git", "gh", "gh", "gh", "gh"],
    );
    runner.assertExhausted();
  });

  it("stops without commit when staged diff is empty", async (): Promise<void> => {
    const runner = new FakeCommandRunner([
      { request: { command: ["git", "add", "--update"] }, result: success },
      { request: { command: ["git", "diff", "--cached", "--quiet"] }, result: success },
    ]);

    await createOrUpdatePullRequest(
      {
        autoMerge: true,
        body: "",
        branch: "update/flakeInput/example",
        dryRun: false,
        labels: ["flakeInput"],
        title: "example: update",
      },
      runner,
      "owner/repository",
    );
    runner.assertExhausted();
  });
});
