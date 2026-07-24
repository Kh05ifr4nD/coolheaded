import type {
  BranchScenario,
  CommandObservation,
  UpdateFailure,
  UpdateState,
} from "./updateStateContract.ts";
import type { CommandRequest } from "coolheaded/core/commandRunner.ts";
import type { ExpectedCommand } from "coolheadedTestSupport/commandRunner.ts";

const success = { code: 0, stderr: "", stdout: "" };

function requests(commands: readonly ExpectedCommand[]): readonly CommandRequest[] {
  return commands.map((command: ExpectedCommand): CommandRequest => {
    if (command.request === undefined) {
      throw new Error("expected fixed command request");
    }
    return command.request;
  });
}

function branchCommands(branch: string, scenario: BranchScenario): readonly ExpectedCommand[] {
  const commands: ExpectedCommand[] = [
    { request: { command: ["git", "fetch", "origin", "main"] }, result: success },
    {
      request: { command: ["git", "fetch", "origin", branch] },
      result: scenario === "missing" ? { code: 1, stderr: "missing", stdout: "" } : success,
    },
    {
      request: {
        command: [
          "git",
          "checkout",
          "-B",
          branch,
          scenario === "missing" ? "origin/main" : `origin/${branch}`,
        ],
      },
      result: success,
    },
  ];
  if (scenario === "missing") {
    return commands;
  }
  commands.push({
    request: { command: ["git", "rebase", "origin/main"] },
    result: scenario === "rebase" ? success : { code: 1, stderr: "conflict", stdout: "" },
  });
  if (scenario === "conflict") {
    commands.push(
      { request: { command: ["git", "rebase", "--abort"] }, result: success },
      {
        request: { command: ["git", "checkout", "-B", branch, "origin/main"] },
        result: success,
      },
    );
  }
  return commands;
}

function gitStates(
  observation: Readonly<CommandObservation>,
  previous: UpdateState | undefined,
): readonly UpdateState[] {
  const { request, result } = observation;
  const [, action, argument, ref] = request.command;
  if (action === "fetch" && ref !== "main") {
    return [result.code === 0 ? "existing" : "absent"];
  }
  if (action === "rebase" && argument === "origin/main") {
    return result.code === 0 ? ["rebased", "validated", "prepared"] : ["conflicted"];
  }
  if (action === "rebase" && argument === "--abort") {
    return ["aborted"];
  }
  if (action === "checkout" && request.command.at(-1) === "origin/main") {
    return previous === "aborted" ? ["fallback", "prepared"] : ["prepared"];
  }
  if (action === "add") {
    return ["staged"];
  }
  if (action === "diff") {
    return result.code === 0 ? ["noChange", "stopped"] : ["changed"];
  }
  if (action === "commit" && result.code === 0) {
    return ["committed"];
  }
  return action === "push" ? ["pushed"] : [];
}

function ghStates(observation: Readonly<CommandObservation>): readonly UpdateState[] {
  const { command } = observation.request;
  const [, group, action] = command;
  if (group !== "pr") {
    return [];
  }
  if (action === "create") {
    return ["prCreated"];
  }
  if (action === "edit") {
    return ["prEdited"];
  }
  return action === "merge" ? ["merged"] : [];
}

function observedStates(
  observations: readonly CommandObservation[],
  failure: UpdateFailure | null,
): readonly UpdateState[] {
  const states: UpdateState[] = ["clean"];
  for (const observation of observations) {
    const [executable] = observation.request.command;
    if (executable === "git") {
      states.push(...gitStates(observation, states.at(-1)));
    } else if (executable === "gh") {
      states.push(...ghStates(observation));
    }
  }
  if (failure !== null) {
    states.push("failed", "stopped");
  }
  return states;
}

export { branchCommands, observedStates, requests, success };
