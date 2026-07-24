class FastCheckFailureError extends Error {
  public override readonly name = "FastCheckFailureError";
  public readonly counterexample: readonly unknown[];
  public readonly counterexampleText: readonly string[];
  public readonly counterexamplePath: string;
  public readonly replayCommand: string;
  public readonly replayArguments: readonly string[];
  public readonly runs: number;
  public readonly seed: number;
  public readonly target: {
    readonly file: string;
    readonly filter: string;
  };

  public constructor(
    target: {
      readonly file: string;
      readonly filter: string;
    },
    result: {
      readonly counterexample: readonly unknown[];
      readonly counterexamplePath: string;
      readonly seed: number;
    },
    runs: number,
    replayCommand: string,
    replayArguments: readonly string[],
  ) {
    const counterexampleText = result.counterexample.map(String);
    super(
      `Property failed. Counterexample: ${JSON.stringify(counterexampleText)}. Replay: ${replayCommand}`,
    );
    this.counterexample = result.counterexample;
    this.counterexampleText = counterexampleText;
    this.counterexamplePath = result.counterexamplePath;
    this.replayCommand = replayCommand;
    this.replayArguments = replayArguments;
    this.runs = runs;
    this.seed = result.seed;
    this.target = target;
  }
}

export { FastCheckFailureError };
