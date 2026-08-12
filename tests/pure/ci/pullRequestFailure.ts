import { assertEquals, assertInstanceOf, assertRejects } from "@jsr/std__assert";
import { CommandExitError } from "coolheadedCi/process.ts";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { createOrUpdatePullRequest } from "coolheadedCi/update/pullRequest.ts";

const success = { code: 0, stderr: "", stdout: "" };
const config = {
  autoMerge: false,
  body: "body",
  branch: "update/package/example",
  dryRun: false,
  labels: ["package"],
  title: "example: update",
};

Deno.test("update control stops after commit failure", async (): Promise<void> => {
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
      result: { code: 1, stderr: "commit failed", stdout: "" },
    },
  ]);
  const error = await assertRejects(() => createOrUpdatePullRequest(config, runner));
  assertInstanceOf(error, CommandExitError);
  runner.assertExhausted();
});

Deno.test("update control stops after push failure", async (): Promise<void> => {
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
      result: { code: 1, stderr: "push failed", stdout: "" },
    },
  ]);
  const error = await assertRejects(() => createOrUpdatePullRequest(config, runner));
  assertInstanceOf(error, CommandExitError);
  runner.assertExhausted();
});

Deno.test("auto-merge rejects missing repository before commands", async (): Promise<void> => {
  await Promise.all(
    [undefined, ""].map(async (repository: string | undefined): Promise<void> => {
      const runner = new FakeCommandRunner([]);
      await assertRejects(() =>
        createOrUpdatePullRequest({ ...config, autoMerge: true }, runner, repository),
      );
      assertEquals(runner.calls(), []);
      runner.assertExhausted();
    }),
  );
});

Deno.test("disabled auto-merge accepts missing repository", async (): Promise<void> => {
  const runner = new FakeCommandRunner([
    { request: { command: ["git", "add", "--update"] }, result: success },
    { request: { command: ["git", "diff", "--cached", "--quiet"] }, result: success },
  ]);
  await createOrUpdatePullRequest(config, runner);
  runner.assertExhausted();
});
