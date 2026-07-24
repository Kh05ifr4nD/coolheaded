import type { UpdateModel, UpdateReal } from "./updateStateContract.ts";
import { requests, success } from "./updateStateOracle.ts";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { assertEquals } from "@jsr/std__assert";
import { createOrUpdatePullRequest } from "coolheadedCi/update/pullRequest.ts";
import type fc from "fast-check";

type PlannedCommand = ConstructorParameters<typeof FakeCommandRunner>[0][number];

function prList(branch: string, number: string): PlannedCommand {
  return {
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
    result: { code: 0, stderr: "", stdout: number },
  };
}

function completionCommands(branch: string, existing: boolean, merge: boolean): PlannedCommand[] {
  const commands: PlannedCommand[] = [
    { request: { command: ["git", "add", "--update"] }, result: success },
    {
      request: { command: ["git", "diff", "--cached", "--quiet"] },
      result: { code: 1, stderr: "", stdout: "" },
    },
    {
      request: { command: ["git", "commit", "--signoff", "-m", "update", "-m", "body"] },
      result: success,
    },
    {
      request: { command: ["git", "push", "--force-with-lease", "origin", `HEAD:${branch}`] },
      result: success,
    },
    prList(branch, existing ? "42" : ""),
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
        command: existing
          ? ["gh", "pr", "edit", "42", "--title", "update", "--body", "body"]
          : [
              "gh",
              "pr",
              "create",
              "--base",
              "main",
              "--head",
              branch,
              "--title",
              "update",
              "--body",
              "body",
              "--label",
              "package",
            ],
      },
      result: success,
    },
  ];
  if (!existing) {
    commands.push(prList(branch, "42"));
  }
  if (merge) {
    commands.push(
      {
        request: {
          command: [
            "gh",
            "api",
            "repos/owner/repository/branches/main/protection/required_status_checks",
          ],
        },
        result: { code: 0, stderr: "", stdout: '{"contexts":["quality"]}' },
      },
      {
        request: { command: ["gh", "pr", "merge", "42", "--auto", "--squash"] },
        result: success,
      },
    );
  }
  return commands;
}

function completeCommand(
  existing: boolean,
  merge: boolean,
): fc.AsyncCommand<UpdateModel, UpdateReal> {
  return {
    check(model: Readonly<UpdateModel>): boolean {
      return model.state.get() === "prepared";
    },
    async run(model: Readonly<UpdateModel>, real: Readonly<UpdateReal>): Promise<void> {
      const expected = completionCommands(model.branch.get(), existing, merge);
      const runner = new FakeCommandRunner(expected);
      await createOrUpdatePullRequest(
        {
          autoMerge: merge,
          body: "body",
          branch: model.branch.get(),
          dryRun: false,
          labels: ["package"],
          title: "update",
        },
        runner,
        "owner/repository",
      );
      runner.assertExhausted();
      assertEquals(runner.calls(), requests(expected));
      real.observations.add(...runner.observations());
      real.operations.set(real.operations.get() + 1);
      real.outcomes.add("succeeded");
      const pullRequestState = existing ? "prEdited" : "prCreated";
      model.history.add("staged", "changed", "committed", "pushed", pullRequestState);
      if (merge) {
        model.history.add("merged");
      }
      model.state.set(merge ? "merged" : pullRequestState);
    },
    toString(): string {
      return `complete(existing=${existing},merge=${merge})`;
    },
  };
}

export { completeCommand };
