import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from "coolheaded/core/commandRunner.ts";

type ExpectedCommand = Readonly<
  {
    readonly effect?: () => Promise<void> | void;
    readonly request: CommandRequest;
  } & (
    | { readonly result: CommandResult; readonly runner?: never }
    | {
        readonly delegateRequest?: CommandRequest;
        readonly result?: never;
        readonly runner: CommandRunner;
      }
  )
>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value: unknown, index: number): boolean => structurallyEqual(value, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).toSorted();
    const rightKeys = Object.keys(right).toSorted();
    return (
      structurallyEqual(leftKeys, rightKeys) &&
      leftKeys.every((key: string): boolean => structurallyEqual(left[key], right[key]))
    );
  }
  return false;
}

class FakeCommandRunner implements CommandRunner {
  readonly #calls: CommandRequest[] = [];
  readonly #expected: ExpectedCommand[];
  readonly #observations: {
    readonly request: CommandRequest;
    readonly result: CommandResult;
  }[] = [];

  public constructor(expected: readonly ExpectedCommand[]) {
    this.#expected = [...expected];
  }

  public async run(request: CommandRequest): Promise<CommandResult> {
    this.#calls.push(request);
    const expected = this.#expected.shift();
    if (expected === undefined) {
      throw new Error(`unexpected command: ${JSON.stringify(request)}`);
    }
    if (!structurallyEqual(request, expected.request)) {
      throw new Error(
        `command mismatch: expected ${JSON.stringify(expected.request)}, received ${JSON.stringify(
          request,
        )}`,
      );
    }
    await expected.effect?.();
    const result =
      expected.runner === undefined
        ? expected.result
        : await expected.runner.run(expected.delegateRequest ?? request);
    this.#observations.push({ request, result });
    return result;
  }

  public assertExhausted(): void {
    if (this.#expected.length > 0) {
      throw new Error(`unconsumed commands: ${JSON.stringify(this.#expected)}`);
    }
  }

  public calls(): readonly CommandRequest[] {
    return this.#calls;
  }

  public observations(): readonly Readonly<{
    readonly request: CommandRequest;
    readonly result: CommandResult;
  }>[] {
    return this.#observations;
  }
}

export { FakeCommandRunner };
export type { ExpectedCommand };
