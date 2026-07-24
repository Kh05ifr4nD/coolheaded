import type { BranchScenario, UpdateModel, UpdateReal } from "./updateStateContract.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "@jsr/std__assert";
import { branchCommands, requests, success } from "./updateStateOracle.ts";
import { CommandExitError } from "coolheadedCi/process.ts";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { completeCommand } from "./updateStateCompletion.ts";
import { createOrUpdatePullRequest } from "coolheadedCi/update/pullRequest.ts";
import fc from "fast-check";
import { prepareBranch } from "coolheadedCi/update/branch.ts";

type PlannedCommand = ConstructorParameters<typeof FakeCommandRunner>[0][number];

function recordObservations(real: Readonly<UpdateReal>, runner: Readonly<FakeCommandRunner>): void {
  real.observations.add(...runner.observations());
  real.operations.set(real.operations.get() + 1);
}

function prepareCommand(
  branch: string,
  scenario: BranchScenario,
): fc.AsyncCommand<UpdateModel, UpdateReal> {
  return {
    check(model: Readonly<UpdateModel>): boolean {
      return model.state.get() === "clean";
    },
    async run(model: Readonly<UpdateModel>, real: Readonly<UpdateReal>): Promise<void> {
      const expected = branchCommands(branch, scenario);
      const runner = new FakeCommandRunner(expected);
      await prepareBranch(branch, runner);
      runner.assertExhausted();
      assertEquals(runner.calls(), requests(expected));
      recordObservations(real, runner);
      real.outcomes.add("succeeded");
      model.branch.set(branch);
      if (scenario === "missing") {
        model.history.add("absent", "prepared");
      } else if (scenario === "rebase") {
        model.history.add("existing", "rebased", "validated", "prepared");
      } else {
        model.history.add("existing", "conflicted", "aborted", "fallback", "prepared");
      }
      model.state.set("prepared");
    },
    toString(): string {
      return `prepare(${scenario},${branch})`;
    },
  };
}

function noChangeCommand(): fc.AsyncCommand<UpdateModel, UpdateReal> {
  return {
    check(model: Readonly<UpdateModel>): boolean {
      return model.state.get() === "prepared";
    },
    async run(model: Readonly<UpdateModel>, real: Readonly<UpdateReal>): Promise<void> {
      const expected: PlannedCommand[] = [
        { request: { command: ["git", "add", "--update"] }, result: success },
        {
          request: { command: ["git", "diff", "--cached", "--quiet"] },
          result: success,
        },
      ];
      const runner = new FakeCommandRunner(expected);
      await createOrUpdatePullRequest(
        {
          autoMerge: false,
          body: "body",
          branch: model.branch.get(),
          dryRun: false,
          labels: ["package"],
          title: "update",
        },
        runner,
      );
      runner.assertExhausted();
      assertEquals(runner.calls(), requests(expected));
      recordObservations(real, runner);
      real.outcomes.add("succeeded");
      model.history.add("staged", "noChange", "stopped");
      model.state.set("stopped");
    },
    toString(): string {
      return "noChange";
    },
  };
}

function refreshCommand(): fc.AsyncCommand<UpdateModel, UpdateReal> {
  return {
    check(model: Readonly<UpdateModel>): boolean {
      return model.state.get() === "prepared";
    },
    async run(model: Readonly<UpdateModel>, real: Readonly<UpdateReal>): Promise<void> {
      const expected = branchCommands(model.branch.get(), "rebase");
      const runner = new FakeCommandRunner(expected);
      await prepareBranch(model.branch.get(), runner);
      runner.assertExhausted();
      assertEquals(runner.calls(), requests(expected));
      recordObservations(real, runner);
      real.outcomes.add("succeeded");
      model.history.add("existing", "rebased", "validated", "prepared");
    },
    toString(): string {
      return "refresh";
    },
  };
}

function failureCommand(): fc.AsyncCommand<UpdateModel, UpdateReal> {
  const command = "failure(commit)";
  return {
    check(model: Readonly<UpdateModel>): boolean {
      return model.state.get() === "prepared";
    },
    async run(model: Readonly<UpdateModel>, real: Readonly<UpdateReal>): Promise<void> {
      const expected: PlannedCommand[] = [
        { request: { command: ["git", "add", "--update"] }, result: success },
        {
          request: { command: ["git", "diff", "--cached", "--quiet"] },
          result: { code: 1, stderr: "", stdout: "" },
        },
        {
          request: { command: ["git", "commit", "--signoff", "-m", "update", "-m", "body"] },
          result: { code: 1, stderr: "failed", stdout: "" },
        },
      ];
      const runner = new FakeCommandRunner(expected);
      const error = await assertRejects(() =>
        createOrUpdatePullRequest(
          {
            autoMerge: false,
            body: "body",
            branch: model.branch.get(),
            dryRun: false,
            labels: ["package"],
            title: "update",
          },
          runner,
        ),
      );
      assertInstanceOf(error, CommandExitError);
      runner.assertExhausted();
      assertEquals(runner.calls(), requests(expected));
      recordObservations(real, runner);
      real.failure.set({ command, request: error.request, result: error.result });
      real.outcomes.add("failed");
      model.history.add("staged", "changed", "failed", "stopped");
      model.state.set("stopped");
    },
    toString(): string {
      return command;
    },
  };
}

const branch = fc.stringMatching(/^update\/package\/[a-z]{1,8}$/u);
function updateCommands(
  replayPath?: string,
): fc.Arbitrary<Iterable<fc.AsyncCommand<UpdateModel, UpdateReal>>> {
  return fc.commands(
    [
      fc
        .tuple(branch, fc.constantFrom<BranchScenario>("missing", "rebase", "conflict"))
        .map(([value, scenario]: readonly [string, BranchScenario]) =>
          prepareCommand(value, scenario),
        ),
      fc.constant(noChangeCommand()),
      fc.constant(refreshCommand()),
      fc.constant(failureCommand()),
      fc
        .tuple(fc.boolean(), fc.boolean())
        .map(([existing, merge]: readonly [boolean, boolean]) => completeCommand(existing, merge)),
    ],
    { maxCommands: 5, ...(replayPath === undefined ? {} : { replayPath }) },
  );
}

export { updateCommands };
