import type { CommandRequest, CommandResult } from "coolheaded/core/commandRunner.ts";

type BranchScenario = "conflict" | "missing" | "rebase";
type UpdateState =
  | "aborted"
  | "absent"
  | "changed"
  | "clean"
  | "committed"
  | "conflicted"
  | "existing"
  | "failed"
  | "fallback"
  | "merged"
  | "noChange"
  | "prCreated"
  | "prEdited"
  | "prepared"
  | "pushed"
  | "rebased"
  | "staged"
  | "stopped"
  | "validated";

interface Cell<Value> {
  readonly get: () => Value;
  readonly set: (value: Value) => void;
}

interface Log<Value> {
  readonly add: (...values: readonly Value[]) => void;
  readonly values: () => readonly Value[];
}

interface CommandObservation {
  readonly request: CommandRequest;
  readonly result: CommandResult;
}

interface UpdateFailure extends CommandObservation {
  readonly command: string;
}

interface UpdateModel {
  readonly branch: Cell<string>;
  readonly history: Log<UpdateState>;
  readonly state: Cell<UpdateState>;
}

interface UpdateReal {
  readonly failure: Cell<UpdateFailure | null>;
  readonly observations: Log<CommandObservation>;
  readonly operations: Cell<number>;
  readonly outcomes: Log<"failed" | "succeeded">;
}

export type {
  BranchScenario,
  Cell,
  CommandObservation,
  Log,
  UpdateFailure,
  UpdateModel,
  UpdateReal,
  UpdateState,
};
