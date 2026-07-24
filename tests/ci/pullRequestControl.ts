import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { createOrUpdatePullRequest } from "coolheadedCi/update/pullRequest.ts";

const success = { code: 0, stderr: "", stdout: "" };
const branch = "update/package/example";
const title = "example: update";
const body = "body";

Deno.test("existing pull request is edited and auto-merged only after protection gate", async () => {
  const runner = new FakeCommandRunner([
    { request: { command: ["git", "add", "--update"] }, result: success },
    {
      request: { command: ["git", "diff", "--cached", "--quiet"] },
      result: { code: 1, stderr: "", stdout: "" },
    },
    {
      request: { command: ["git", "commit", "--signoff", "-m", title, "-m", body] },
      result: success,
    },
    {
      request: {
        command: ["git", "push", "--force-with-lease", "origin", `HEAD:${branch}`],
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
          branch,
          "--json",
          "number",
          "--jq",
          ".[0].number // empty",
        ],
      },
      result: { code: 0, stderr: "", stdout: "42" },
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
      request: { command: ["gh", "pr", "edit", "42", "--title", title, "--body", body] },
      result: success,
    },
    {
      request: {
        command: [
          "gh",
          "api",
          "repos/owner/repository/branches/main/protection/required_status_checks",
        ],
      },
      result: { code: 1, stderr: "not configured", stdout: "" },
    },
    {
      request: { command: ["gh", "api", "repos/owner/repository/rulesets"] },
      result: {
        code: 0,
        stderr: "",
        stdout: JSON.stringify([{ enforcement: "active", id: 7, target: "branch" }]),
      },
    },
    {
      request: { command: ["gh", "api", "repos/owner/repository/rulesets/7"] },
      result: {
        code: 0,
        stderr: "",
        stdout: JSON.stringify({
          enforcement: "active",
          rules: [
            {
              parameters: { required_status_checks: [{ context: "quality" }] },
              type: "required_status_checks",
            },
          ],
          target: "branch",
        }),
      },
    },
    {
      request: { command: ["gh", "pr", "merge", "42", "--auto", "--squash"] },
      result: success,
    },
  ]);
  await createOrUpdatePullRequest(
    {
      autoMerge: true,
      body,
      branch,
      dryRun: false,
      labels: ["package"],
      title,
    },
    runner,
    "owner/repository",
  );
  runner.assertExhausted();
});
