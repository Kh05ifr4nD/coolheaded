import { git, initializedRepositories, realGit } from "./updateGitFixture.ts";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { assertEquals } from "@jsr/std__assert";
import { createOrUpdatePullRequest } from "coolheadedCi/update/pullRequest.ts";
import { prepareBranch } from "coolheadedCi/update/branch.ts";

const success = { code: 0, stderr: "", stdout: "" };

Deno.test("update control uses real Git and never executes gh", async (): Promise<void> => {
  const root = await Deno.makeTempDir();
  try {
    const { checkout, remote } = await initializedRepositories(root);
    const branch = "update/package/example";
    const gitRunner = new FakeCommandRunner([
      realGit(["git", "fetch", "origin", "main"], checkout),
      realGit(["git", "fetch", "origin", branch], checkout),
      realGit(["git", "checkout", "-B", branch, "origin/main"], checkout),
    ]);
    await prepareBranch(branch, gitRunner);
    gitRunner.assertExhausted();
    assertEquals(await git(["branch", "--show-current"], checkout), branch);

    await Deno.writeTextFile(`${checkout}/tracked.txt`, "changed\n");
    const title = "example: update";
    const body = "body";
    const runner = new FakeCommandRunner([
      realGit(["git", "add", "--update"], checkout),
      realGit(["git", "diff", "--cached", "--quiet"], checkout),
      realGit(["git", "commit", "--signoff", "-m", title, "-m", body], checkout),
      realGit(["git", "push", "--force-with-lease", "origin", `HEAD:${branch}`], checkout),
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
            branch,
            "--title",
            title,
            "--body",
            body,
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
            branch,
            "--json",
            "number",
            "--jq",
            ".[0].number // empty",
          ],
        },
        result: { code: 0, stderr: "", stdout: "42" },
      },
    ]);
    await createOrUpdatePullRequest(
      { autoMerge: false, body, branch, dryRun: false, labels: ["package"], title },
      runner,
    );
    runner.assertExhausted();
    assertEquals(
      await git(["--git-dir", remote, "rev-parse", `refs/heads/${branch}`]),
      await git(["rev-parse", "HEAD"], checkout),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
