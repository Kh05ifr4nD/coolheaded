import { FastCheckFailureError } from "coolheadedTestSupport/fastCheckError.ts";
import fc from "fast-check";

const DEFAULT_FAST_CHECK_RUNS = 100;
const DEFAULT_FAST_CHECK_SEED = 24_301;
const MAX_FAST_CHECK_RUNS = 10_000;
const MAX_FAST_CHECK_SEED = 2_147_483_647;
const MIN_FAST_CHECK_SEED = -2_147_483_648;

interface FastCheckConfig {
  readonly path?: string;
  readonly runs: number;
  readonly seed: number;
}

interface ReplayTarget {
  readonly file: string;
  readonly filter: string;
  readonly replayArgument?: () => string;
}

interface FastCheckResult {
  readonly counterexample: readonly unknown[] | null;
  readonly counterexamplePath: string | null;
  readonly failed: boolean;
  readonly seed: number;
}

type FastCheckEnvironment = Readonly<Record<string, string | undefined>>;

class InvalidFastCheckEnvironmentError extends TypeError {
  public override readonly name = "InvalidFastCheckEnvironmentError";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

const replayTargets = new Set<string>();

function canonicalInteger(
  name: string,
  value: string,
  pattern: Readonly<RegExp>,
  minimum: number,
  maximum: number,
): number {
  if (!pattern.test(value)) {
    throw new InvalidFastCheckEnvironmentError(`${name} must use canonical decimal syntax`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new InvalidFastCheckEnvironmentError(`${name} is outside its supported range`);
  }

  return parsed;
}

function runtimeEnvironment(): FastCheckEnvironment {
  return {
    FAST_CHECK_PATH: Deno.env.get("FAST_CHECK_PATH"),
    FAST_CHECK_RUNS: Deno.env.get("FAST_CHECK_RUNS"),
    FAST_CHECK_SEED: Deno.env.get("FAST_CHECK_SEED"),
  };
}

function fastCheckConfig(
  environment: FastCheckEnvironment = runtimeEnvironment(),
): FastCheckConfig {
  const seedValue = environment["FAST_CHECK_SEED"];
  const runsValue = environment["FAST_CHECK_RUNS"];
  const pathValue = environment["FAST_CHECK_PATH"];
  const seed =
    seedValue === undefined
      ? DEFAULT_FAST_CHECK_SEED
      : canonicalInteger(
          "FAST_CHECK_SEED",
          seedValue,
          /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/u,
          MIN_FAST_CHECK_SEED,
          MAX_FAST_CHECK_SEED,
        );
  const runs =
    runsValue === undefined
      ? DEFAULT_FAST_CHECK_RUNS
      : canonicalInteger("FAST_CHECK_RUNS", runsValue, /^[1-9][0-9]*$/u, 1, MAX_FAST_CHECK_RUNS);

  if (pathValue === undefined) {
    return { runs, seed };
  }
  if (seedValue === undefined) {
    throw new InvalidFastCheckEnvironmentError(
      "FAST_CHECK_PATH requires an explicit FAST_CHECK_SEED",
    );
  }
  if (!/^(?:0|[1-9][0-9]*)(?::(?:0|[1-9][0-9]*))*$/u.test(pathValue)) {
    throw new InvalidFastCheckEnvironmentError(
      "FAST_CHECK_PATH must contain canonical colon-separated nonnegative decimals",
    );
  }

  return { path: pathValue, runs, seed };
}

function defineReplayTarget(
  file: string,
  filter: string,
  replayArgument?: () => string,
): ReplayTarget {
  if (file.length === 0 || filter.length === 0 || file.includes("\0") || filter.includes("\0")) {
    throw new TypeError("Fast-check replay target must have a non-empty file and filter");
  }

  const key = `${file}\0${filter}`;
  if (replayTargets.has(key)) {
    throw new TypeError("Duplicate fast-check replay target");
  }
  replayTargets.add(key);

  return Object.freeze({
    file,
    filter,
    ...(replayArgument === undefined ? {} : { replayArgument }),
  });
}

function assertResult(target: ReplayTarget, result: Readonly<FastCheckResult>, runs: number): void {
  if (result.failed) {
    if (result.counterexample === null || result.counterexamplePath === null) {
      throw new TypeError("Failed fast-check result omitted replay details");
    }
    const replayArguments = target.replayArgument === undefined ? [] : [target.replayArgument()];
    const replayCommand = [
      `FAST_CHECK_SEED=${shellQuote(String(result.seed))}`,
      `FAST_CHECK_PATH=${shellQuote(result.counterexamplePath)}`,
      `FAST_CHECK_RUNS=${shellQuote(String(runs))}`,
      "deno test --no-check",
      "--allow-env=FAST_CHECK_SEED,FAST_CHECK_PATH,FAST_CHECK_RUNS",
      `--filter ${shellQuote(target.filter)}`,
      shellQuote(target.file),
      ...(replayArguments.length === 0
        ? []
        : ["--", ...replayArguments.map((argument: string): string => shellQuote(argument))]),
    ].join(" ");
    throw new FastCheckFailureError(
      target,
      {
        counterexample: result.counterexample,
        counterexamplePath: result.counterexamplePath,
        seed: result.seed,
      },
      runs,
      replayCommand,
      replayArguments,
    );
  }
}

function assertProperty<Parameters extends [unknown, ...unknown[]]>(
  target: ReplayTarget,
  property: Readonly<ReturnType<typeof fc.property<Parameters>>>,
  environment?: FastCheckEnvironment,
): void {
  const config = fastCheckConfig(environment);
  const result = fc.check(property, {
    ...(config.path === undefined ? {} : { path: config.path }),
    numRuns: config.runs,
    seed: config.seed,
  });
  assertResult(target, result, config.runs);
}

async function assertAsyncProperty<Parameters extends [unknown, ...unknown[]]>(
  target: ReplayTarget,
  property: Readonly<ReturnType<typeof fc.asyncProperty<Parameters>>>,
  environment?: FastCheckEnvironment,
): Promise<void> {
  const config = fastCheckConfig(environment);
  const result = await fc.check(property, {
    ...(config.path === undefined ? {} : { path: config.path }),
    numRuns: config.runs,
    seed: config.seed,
  });
  assertResult(target, result, config.runs);
}

export {
  DEFAULT_FAST_CHECK_RUNS,
  DEFAULT_FAST_CHECK_SEED,
  InvalidFastCheckEnvironmentError,
  MAX_FAST_CHECK_RUNS,
  assertAsyncProperty,
  assertProperty,
  defineReplayTarget,
  fastCheckConfig,
};
export { FastCheckFailureError } from "coolheadedTestSupport/fastCheckError.ts";
export type { FastCheckConfig, FastCheckEnvironment, ReplayTarget };
