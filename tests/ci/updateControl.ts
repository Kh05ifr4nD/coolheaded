import { describe, it } from "@jsr/std__testing/bdd";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { assertEquals } from "@jsr/std__assert";
import { prepareBranch } from "coolheadedCi/update/branch.ts";

const success = { code: 0, stderr: "", stdout: "" };
const LAST_TWO_COMMANDS = 2;

describe("update control command runner", (): void => {
  it("prepares a missing update branch through the injected runner", async (): Promise<void> => {
    const runner = new FakeCommandRunner([
      {
        request: { command: ["git", "fetch", "origin", "main"] },
        result: success,
      },
      {
        request: { command: ["git", "fetch", "origin", "update/package/example"] },
        result: { code: 1, stderr: "missing", stdout: "" },
      },
      {
        request: {
          command: ["git", "checkout", "-B", "update/package/example", "origin/main"],
        },
        result: success,
      },
    ]);

    await prepareBranch("update/package/example", runner);
    runner.assertExhausted();
  });

  it("rebases an existing branch without fallback", async (): Promise<void> => {
    const branch = "update/package/example";
    const runner = new FakeCommandRunner([
      { request: { command: ["git", "fetch", "origin", "main"] }, result: success },
      { request: { command: ["git", "fetch", "origin", branch] }, result: success },
      {
        request: { command: ["git", "checkout", "-B", branch, `origin/${branch}`] },
        result: success,
      },
      { request: { command: ["git", "rebase", "origin/main"] }, result: success },
    ]);

    await prepareBranch(branch, runner);
    assertEquals(runner.calls().at(-1)?.command, ["git", "rebase", "origin/main"]);
    runner.assertExhausted();
  });

  it("aborts a conflicting rebase before main fallback", async (): Promise<void> => {
    const branch = "update/package/example";
    const runner = new FakeCommandRunner([
      { request: { command: ["git", "fetch", "origin", "main"] }, result: success },
      { request: { command: ["git", "fetch", "origin", branch] }, result: success },
      {
        request: { command: ["git", "checkout", "-B", branch, `origin/${branch}`] },
        result: success,
      },
      {
        request: { command: ["git", "rebase", "origin/main"] },
        result: { code: 1, stderr: "conflict", stdout: "" },
      },
      { request: { command: ["git", "rebase", "--abort"] }, result: success },
      {
        request: { command: ["git", "checkout", "-B", branch, "origin/main"] },
        result: success,
      },
    ]);

    await prepareBranch(branch, runner);
    assertEquals(
      runner
        .calls()
        .slice(-LAST_TWO_COMMANDS)
        .map((request): readonly string[] => request.command),
      [
        ["git", "rebase", "--abort"],
        ["git", "checkout", "-B", branch, "origin/main"],
      ],
    );
    runner.assertExhausted();
  });
});
