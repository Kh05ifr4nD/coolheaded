import type {
  Cell,
  Log,
  UpdateFailure,
  UpdateModel,
  UpdateReal,
  UpdateState,
} from "./updateStateContract.ts";
import {
  InvalidFastCheckEnvironmentError,
  assertAsyncProperty,
  defineReplayTarget,
  fastCheckConfig,
} from "coolheadedTestSupport/fastCheck.ts";
import { assert, assertEquals, assertThrows } from "@jsr/std__assert";
import fc from "fast-check";
import { observedStates } from "./updateStateOracle.ts";
import { updateCommands } from "./updateStateModel.ts";

interface ReplayableCommands extends Iterable<fc.AsyncCommand<UpdateModel, UpdateReal>> {
  readonly metadataForReplay: () => string;
}

function cell<Value>(initial: Value): Cell<Value> {
  let value = initial;
  return {
    get(): Value {
      return value;
    },
    set(next: Value): void {
      value = next;
    },
  };
}

function log<Value>(initial: readonly Value[] = []): Log<Value> {
  const values = [...initial];
  return {
    add(...items: readonly Value[]): void {
      values.push(...items);
    },
    values(): readonly Value[] {
      return values;
    },
  };
}

function state(): { readonly model: UpdateModel; readonly real: UpdateReal } {
  return {
    model: {
      branch: cell(""),
      history: log<UpdateState>(["clean"]),
      state: cell<UpdateState>("clean"),
    },
    real: {
      failure: cell<UpdateFailure | null>(null),
      observations: log(),
      operations: cell(0),
      outcomes: log(),
    },
  };
}

function commandsReplayPath(path: string | null, args: readonly string[]): string | undefined {
  if (path === null) {
    if (args.length > 0) {
      throw new InvalidFastCheckEnvironmentError(
        "Commands replay argument requires FAST_CHECK_PATH",
      );
    }
    return undefined;
  }
  const [replayPath] = args;
  if (
    args.length !== 1 ||
    replayPath === undefined ||
    replayPath.length === 0 ||
    replayPath.includes("\0")
  ) {
    throw new InvalidFastCheckEnvironmentError(
      "FAST_CHECK_PATH requires one non-empty commands replay argument",
    );
  }
  return replayPath;
}

function isReplayableCommands(
  commands: Readonly<Iterable<fc.AsyncCommand<UpdateModel, UpdateReal>>>,
): commands is ReplayableCommands {
  return "metadataForReplay" in commands && typeof commands.metadataForReplay === "function";
}

function replayableCommands(
  commands: Readonly<Iterable<fc.AsyncCommand<UpdateModel, UpdateReal>>>,
): ReplayableCommands {
  if (!isReplayableCommands(commands)) {
    throw new TypeError("fc.commands omitted replay metadata");
  }
  return commands;
}

function replayArgument(metadata: string): string {
  const prefix = "replayPath=";
  if (!metadata.startsWith(prefix)) {
    throw new TypeError("fc.commands emitted invalid replay metadata");
  }
  const value: unknown = JSON.parse(metadata.slice(prefix.length));
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new TypeError("fc.commands emitted invalid replay path");
  }
  return value;
}

const testName = "update control obeys generated legal state transitions";
const failureObservationCount = 3;

Deno.test("update control validates commands replay arguments", (): void => {
  assert(commandsReplayPath(null, []) === void 0);
  assertEquals(commandsReplayPath("0", ["opaque:replay"]), "opaque:replay");
  for (const [path, args] of [
    [null, ["unexpected"]],
    ["0", []],
    ["0", [""]],
    ["0", ["invalid\0path"]],
    ["0", ["one", "two"]],
  ] satisfies readonly (readonly [string | null, readonly string[]])[]) {
    assertThrows((): void => {
      commandsReplayPath(path, args);
    }, InvalidFastCheckEnvironmentError);
  }
});

Deno.test(testName, async (): Promise<void> => {
  const config = fastCheckConfig();
  const requestedReplayPath = commandsReplayPath(config.path ?? null, Deno.args);
  let finalReplayArgument: string | null = null;
  let maximumOperations = 0;
  let longestCommands: readonly string[] = [];
  const reachedStates = new Set<UpdateState>();
  await assertAsyncProperty(
    defineReplayTarget("tests/ci/updateState.ts", testName, (): string => {
      if (finalReplayArgument === null) {
        throw new TypeError("fc.commands omitted final replay path");
      }
      return finalReplayArgument;
    }),
    fc.asyncProperty(
      updateCommands(requestedReplayPath),
      async (
        commands: Readonly<Iterable<fc.AsyncCommand<UpdateModel, UpdateReal>>>,
      ): Promise<void> => {
        const replayable = replayableCommands(commands);
        const current = state();
        const commandList = [...replayable];
        try {
          await fc.asyncModelRun(
            (): { readonly model: UpdateModel; readonly real: UpdateReal } => current,
            commandList,
          );
        } finally {
          finalReplayArgument = replayArgument(replayable.metadataForReplay());
        }
        const observed = observedStates(
          current.real.observations.values(),
          current.real.failure.get(),
        );
        assertEquals(observed, current.model.history.values());
        assertEquals(current.real.operations.get(), current.real.outcomes.values().length);
        const failure = current.real.failure.get();
        if (failure !== null) {
          assertEquals(failure.command, "failure(commit)");
          assertEquals(current.model.state.get(), "stopped");
          assertEquals(failure.request, {
            command: ["git", "commit", "--signoff", "-m", "update", "-m", "body"],
          });
          assertEquals(failure.result, { code: 1, stderr: "failed", stdout: "" });
          assertEquals(current.real.observations.values().slice(-failureObservationCount, -1), [
            {
              request: { command: ["git", "add", "--update"] },
              result: { code: 0, stderr: "", stdout: "" },
            },
            {
              request: { command: ["git", "diff", "--cached", "--quiet"] },
              result: { code: 1, stderr: "", stdout: "" },
            },
          ]);
          assertEquals(current.real.observations.values().at(-1), {
            request: failure.request,
            result: failure.result,
          });
        }
        maximumOperations = Math.max(maximumOperations, current.real.operations.get());
        const serialized = commandList.map(String);
        if (serialized.length > longestCommands.length) {
          longestCommands = serialized;
        }
        for (const observedState of observed) {
          reachedStates.add(observedState);
        }
      },
    ),
  );
  if (config.path === undefined) {
    assert(maximumOperations > 2);
    assert(longestCommands.length >= 3);
    const requiredStates: readonly UpdateState[] = [
      "absent",
      "existing",
      "rebased",
      "conflicted",
      "aborted",
      "fallback",
      "stopped",
      "failed",
      "prCreated",
      "prEdited",
      "merged",
    ];
    assertEquals(
      requiredStates.filter((candidate: UpdateState): boolean => !reachedStates.has(candidate)),
      [],
    );
  }
});
