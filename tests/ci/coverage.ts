import { CoverageInputError, parseLcov, trackedRuntimeSources } from "coolheadedCi/coverage.ts";
import { assertEquals, assertInstanceOf, assertStrictEquals, assertThrows } from "@jsr/std__assert";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { toFileUrl } from "@jsr/std__path";

const NATIVE_BRANCH_COVERED = 5;
const NATIVE_BRANCH_TOTAL = 6;
const NATIVE_LINE_COVERED = 19;
const NATIVE_LINE_TOTAL = 21;
const ROOT = "/workspace/repository";
const SOURCE = `${ROOT}/lib/ts/core/version.ts`;
const MD5 = "d41d8cd98f00b204e9800998ecf8427e";
const EMPTY_COUNTERS = ["BRF:0", "BRH:0", "LF:0", "LH:0"] as const;
const NATIVE_DETAILS = [
  "FN:3,canonicalSemver",
  "FN:11,parseSemver",
  "FN:20,compareVersions",
  "FN:24,isSemver",
  "FNDA:503,canonicalSemver",
  "FNDA:444,parseSemver",
  "FNDA:222,compareVersions",
  "FNDA:59,isSemver",
  "FNF:4",
  "FNH:4",
  "BRDA:6,1,0,142",
  "BRDA:6,1,1,361",
  "BRDA:8,1,0,493",
  "BRDA:8,1,1,10",
  "BRDA:13,2,0,0",
  "BRDA:13,2,1,444",
  "BRF:6",
  "BRH:5",
  "DA:1,1",
  "DA:3,503",
  "DA:4,503",
  "DA:5,503",
  "DA:6,503",
  "DA:8,503",
  "DA:9,503",
  "DA:11,444",
  "DA:12,444",
  "DA:13,444",
  "DA:14,0",
  "DA:15,0",
  "DA:17,444",
  "DA:18,444",
  "DA:20,222",
  "DA:21,222",
  "DA:22,222",
  "DA:24,59",
  "DA:25,59",
  "DA:26,59",
  "DA:28,1",
  "LH:19",
  "LF:21",
] as const;

function lcov(lines: readonly string[], source: string = SOURCE): string {
  return [`SF:${source}`, ...lines, "end_of_record", ""].join("\n");
}

function inputError(input: string): CoverageInputError {
  const error = assertThrows((): void => {
    parseLcov(input, ROOT);
  });
  assertInstanceOf(error, CoverageInputError);
  return error;
}

Deno.test("LCOV parser derives native detail counters from absolute and file URL sources", (): void => {
  const expected = [
    {
      branches: { covered: NATIVE_BRANCH_COVERED, total: NATIVE_BRANCH_TOTAL },
      lines: { covered: NATIVE_LINE_COVERED, total: NATIVE_LINE_TOTAL },
      path: "lib/ts/core/version.ts",
    },
  ];
  const fileUrlSource = toFileUrl(SOURCE).href;
  assertEquals(parseLcov(lcov(NATIVE_DETAILS), ROOT), expected);
  assertEquals(parseLcov(lcov(NATIVE_DETAILS, fileUrlSource), ROOT), expected);
});

Deno.test("LCOV parser accepts canonical optional DA checksum", (): void => {
  const details = [`DA:1,1,${MD5}`, "LF:1", "LH:1", "BRF:0", "BRH:0", "FNF:0", "FNH:0"];
  assertEquals(parseLcov(lcov(details), ROOT)[0]?.lines, { covered: 1, total: 1 });
});

Deno.test("LCOV parser preserves ordered duplicate function occurrences", (): void => {
  for (const functions of [
    ["FN:117,request", "FN:129,request", "FNDA:0,request", "FNDA:3,request", "FNF:2", "FNH:1"],
    ["FN:1,first", "FN:1,second", "FNDA:1,first", "FNDA:1,second", "FNF:2", "FNH:2"],
    ["FN:1,request", "FN:2,request", "FNDA:1,request", "FNDA:1,request", "FNF:2", "FNH:2"],
  ]) {
    assertEquals(parseLcov(lcov([...functions, ...EMPTY_COUNTERS]), ROOT)[0]?.lines, {
      covered: 0,
      total: 0,
    });
  }
});

Deno.test("LCOV parser rejects absolute and file URL aliases as one duplicate source", (): void => {
  const absoluteRecord = lcov(NATIVE_DETAILS);
  const fileUrlRecord = lcov(NATIVE_DETAILS, toFileUrl(SOURCE).href);
  const error = inputError(`${absoluteRecord}${fileUrlRecord}`);
  assertEquals(error.kind, "duplicateSource");
  assertEquals(error.details, { path: "lib/ts/core/version.ts" });
});

for (const [name, lines, field] of [
  ["zero DA line", ["DA:0,1"], "DA"],
  ["zero BRDA line", ["BRDA:0,0,0,1"], "BRDA"],
  ["negative block", ["BRDA:1,-1,0,1"], "BRDA"],
  ["empty branch", ["BRDA:1,0,,1"], "BRDA"],
  ["unsafe count", [`DA:1,${Number.MAX_SAFE_INTEGER + 1}`], "DA"],
  ["unsafe block", [`BRDA:1,${Number.MAX_SAFE_INTEGER + 1},0,1`], "BRDA"],
  ["unsafe branch", [`BRDA:1,0,${Number.MAX_SAFE_INTEGER + 1},1`], "BRDA"],
  ["unsafe taken", [`BRDA:1,0,0,${Number.MAX_SAFE_INTEGER + 1}`], "BRDA"],
  ["empty checksum", ["DA:1,1,"], "DA"],
  ["noncanonical checksum", ["DA:1,1,ABC"], "DA"],
  ["extra DA field", [`DA:1,1,${MD5},extra`], "DA"],
  ["zero function line", ["FN:0,name"], "FN"],
  ["unsafe function line", [`FN:${Number.MAX_SAFE_INTEGER + 1},name`], "FN"],
  ["unsafe function count", [`FNDA:${Number.MAX_SAFE_INTEGER + 1},name`], "FNDA"],
  ["empty function name", ["FN:1,"], "FN"],
  ["duplicate function tuple", ["FN:1,name", "FN:1,name"], "FN"],
  ["reversed function counts", ["FN:1,first", "FN:2,second", "FNDA:1,second"], "FNDA"],
  ["interleaved function definition", ["FN:1,first", "FNDA:1,first", "FN:2,second"], "FN"],
  ["function count after summary", ["FN:1,name", "FNF:1", "FNDA:1,name"], "FNDA"],
] as const) {
  Deno.test(`LCOV parser rejects ${name}`, (): void => {
    const error = inputError(lcov(lines));
    assertEquals(error.kind, "malformedLcov");
    assertEquals(error.details["field"], field);
  });
}

for (const [name, lines] of [
  ["incomplete summaries", ["FNF:0", "FNH:0"]],
  ["inconsistent line summaries", ["LF:1", "LH:1", "BRF:0", "BRH:0", "FNF:0", "FNH:0"]],
  [
    "function without hit record",
    ["FN:1,name", "LF:0", "LH:0", "BRF:0", "BRH:0", "FNF:1", "FNH:0"],
  ],
  [
    "hit record without function",
    ["FNDA:1,name", "LF:0", "LH:0", "BRF:0", "BRH:0", "FNF:1", "FNH:1"],
  ],
  [
    "wrong function summary",
    ["FN:1,name", "FNDA:1,name", "LF:0", "LH:0", "BRF:0", "BRH:0", "FNF:2", "FNH:1"],
  ],
  ["duplicate summary", ["LF:0", "LF:0"]],
  ["branch hit exceeds found", ["LF:0", "LH:0", "BRF:1", "BRH:2", "FNF:0", "FNH:0"]],
  ["function hit exceeds found", ["LF:0", "LH:0", "BRF:0", "BRH:0", "FNF:1", "FNH:2"]],
] as const) {
  Deno.test(`LCOV parser rejects ${name}`, (): void => {
    assertEquals(inputError(lcov(lines)).kind, "malformedLcov");
  });
}

for (const [name, source] of [
  ["relative paths", "lib/ts/core/version.ts"],
  ["outside paths", "/outside/version.ts"],
  ["unknown schemes", "https://example.com/version.ts"],
  ["URL queries", `${toFileUrl(SOURCE).href}?alias=1`],
  ["invalid URL encoding", "file:///workspace/repository/%E0%A4%A"],
] as const) {
  Deno.test(`LCOV parser rejects ${name}`, (): void => {
    const error = inputError(lcov(NATIVE_DETAILS, source));
    assertEquals(error.kind, "invalidSource");
    assertEquals(error.details["source"], source);
  });
}

function inventoryRunner(
  git: string,
  result: Readonly<{ readonly code: number; readonly stderr: string; readonly stdout: string }>,
): FakeCommandRunner {
  return new FakeCommandRunner([
    {
      request: {
        command: [git, "ls-files", "-z", "--", ".github/ci", "lib/ts", "packages"],
      },
      result,
    },
  ]);
}

Deno.test("tracked runtime inventory uses one broad Git path query", async (): Promise<void> => {
  const git = "/nix/store/git/bin/git";
  const runner = inventoryRunner(git, {
    code: 0,
    stderr: "",
    stdout: "tests/ignored.ts\0lib/ts/core/version.ts\0packages/codex/update.ts\0",
  });
  assertEquals(await trackedRuntimeSources(runner, git), [
    "lib/ts/core/version.ts",
    "packages/codex/update.ts",
  ]);
  runner.assertExhausted();
});

Deno.test("tracked runtime inventory preserves nonzero result identity", async (): Promise<void> => {
  const git = "/nix/store/git/bin/git";
  const result = { code: 2, stderr: "failure", stdout: "partial\0" } as const;
  const runner = inventoryRunner(git, result);
  const error = await Effect.runPromise(
    Effect.flip(
      Effect.tryPromise({
        catch: (cause: unknown): unknown => cause,
        try: (): Promise<readonly string[]> => trackedRuntimeSources(runner, git),
      }),
    ),
  );
  assertInstanceOf(error, CoverageInputError);
  assertEquals(error.kind, "inventoryFailure");
  assertStrictEquals(error.details["result"], result);
});

Deno.test("tracked runtime inventory preserves runner rejection cause identity", async (): Promise<void> => {
  const git = "/nix/store/git/bin/git";
  const cause = new Error("start");
  const rejectingRunner = {
    run: (): Promise<never> => Promise.reject(cause),
  } satisfies CommandRunner;
  const runner = new FakeCommandRunner([
    {
      request: {
        command: [git, "ls-files", "-z", "--", ".github/ci", "lib/ts", "packages"],
      },
      runner: rejectingRunner,
    },
  ]);
  const error = await Effect.runPromise(
    Effect.flip(
      Effect.tryPromise({
        catch: (failure: unknown): unknown => failure,
        try: (): Promise<readonly string[]> => trackedRuntimeSources(runner, git),
      }),
    ),
  );
  assertInstanceOf(error, CoverageInputError);
  assertEquals(error.kind, "inventoryFailure");
  assertStrictEquals(error.details["cause"], cause);
  assertStrictEquals(error.cause, cause);
});
