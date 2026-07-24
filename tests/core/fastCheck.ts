import {
  DEFAULT_FAST_CHECK_RUNS,
  DEFAULT_FAST_CHECK_SEED,
  FastCheckFailureError,
  InvalidFastCheckEnvironmentError,
  MAX_FAST_CHECK_RUNS,
  assertProperty,
  defineReplayTarget,
  fastCheckConfig,
} from "coolheadedTestSupport/fastCheck.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertStringIncludes,
  assertThrows,
} from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import fc from "fast-check";

const deterministicReplayName =
  "fast-check reports a deterministic replay command with 'quoted' target";
const adjacentPropertyName = "fast-check keeps replay paths isolated from adjacent properties";

function failingIntegerProperty(): fc.IPropertyWithHooks<[number]> {
  return fc.property(fc.integer(), (_value: number): boolean => false);
}

function capturedFailure(
  target: ReturnType<typeof defineReplayTarget>,
  environment?: Readonly<Record<string, string | undefined>>,
): FastCheckFailureError {
  try {
    assertProperty(target, failingIntegerProperty(), environment);
  } catch (error: unknown) {
    assertInstanceOf(error, FastCheckFailureError);
    return error;
  }

  throw new Error("Expected property failure");
}

describe("fast-check replay support", (): void => {
  it("uses stable deterministic defaults", (): void => {
    assertEquals(fastCheckConfig({}), {
      runs: DEFAULT_FAST_CHECK_RUNS,
      seed: DEFAULT_FAST_CHECK_SEED,
    });
  });

  it("rejects invalid present environment before executing a property", (): void => {
    for (const environment of [
      { FAST_CHECK_SEED: "" },
      { FAST_CHECK_SEED: "+1" },
      { FAST_CHECK_SEED: "01" },
      { FAST_CHECK_SEED: "2147483648" },
      { FAST_CHECK_RUNS: "" },
      { FAST_CHECK_RUNS: "0" },
      { FAST_CHECK_RUNS: "01" },
      { FAST_CHECK_RUNS: String(MAX_FAST_CHECK_RUNS + 1) },
      { FAST_CHECK_PATH: "0" },
      { FAST_CHECK_PATH: "", FAST_CHECK_SEED: "1" },
      { FAST_CHECK_PATH: "00", FAST_CHECK_SEED: "1" },
      { FAST_CHECK_PATH: "0:01", FAST_CHECK_SEED: "1" },
      { FAST_CHECK_PATH: "0::1", FAST_CHECK_SEED: "1" },
    ] satisfies readonly Readonly<Record<string, string>>[]) {
      assertThrows((): void => {
        fastCheckConfig(environment);
      }, InvalidFastCheckEnvironmentError);
    }

    let executed = false;
    const target = defineReplayTarget(
      "tests/core/fastCheck.ts",
      "fast-check replay support rejects invalid environment",
    );
    assertThrows((): void => {
      assertProperty(
        target,
        fc.property(fc.constant(null), (): boolean => {
          executed = true;
          return true;
        }),
        { FAST_CHECK_RUNS: "0" },
      );
    }, InvalidFastCheckEnvironmentError);
    assertEquals(executed, false);
  });

  it("rejects duplicate replay targets", (): void => {
    defineReplayTarget("tests/core/fastCheck.ts", "fast-check replay support duplicate target");
    assertThrows(
      (): void => {
        defineReplayTarget("tests/core/fastCheck.ts", "fast-check replay support duplicate target");
      },
      TypeError,
      "Duplicate fast-check replay target",
    );
  });
});

Deno.test(deterministicReplayName, (): void => {
  const target = defineReplayTarget("tests/core/fastCheck.ts", deterministicReplayName);
  const replaying = Deno.env.get("FAST_CHECK_PATH") !== undefined;
  const failure = capturedFailure(
    target,
    replaying
      ? undefined
      : {
          FAST_CHECK_RUNS: "23",
          FAST_CHECK_SEED: "42",
        },
  );
  if (replaying) {
    throw failure;
  }

  assertStringIncludes(
    failure.message,
    `FAST_CHECK_SEED='${failure.seed}' FAST_CHECK_PATH='${failure.counterexamplePath}' FAST_CHECK_RUNS='23'`,
  );
  assertStringIncludes(
    failure.message,
    `--filter 'fast-check reports a deterministic replay command with '"'"'quoted'"'"' target'`,
  );
  assertStringIncludes(failure.message, "'tests/core/fastCheck.ts'");
});

Deno.test(adjacentPropertyName, (): void => {
  let runs = 0;
  const target = defineReplayTarget("tests/core/fastCheck.ts", adjacentPropertyName);
  assertProperty(
    target,
    fc.property(fc.constant(null), (): boolean => {
      runs += 1;
      return true;
    }),
    {},
  );
  assertEquals(runs, DEFAULT_FAST_CHECK_RUNS);
});
