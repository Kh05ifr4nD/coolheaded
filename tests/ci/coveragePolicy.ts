import {
  CoveragePolicyError,
  DECLARATIVE_SOURCE_ENGINES,
  evaluateCoverage,
  sourceClassification,
  validateClassification,
} from "coolheadedCi/coveragePolicy.ts";
import { assertEquals, assertInstanceOf, assertThrows } from "@jsr/std__assert";

type SourceCoverage = Parameters<typeof evaluateCoverage>[1][number];

function source(
  path: string,
  lines: readonly [number, number],
  branches: readonly [number, number],
): SourceCoverage {
  return {
    branches: { covered: branches[0], total: branches[1] },
    lines: { covered: lines[0], total: lines[1] },
    path,
  };
}

const PURE = "lib/ts/core/version.ts";
const ADAPTER = "lib/ts/core/fetchHttpClient.ts";
const ADAPTER_BRANCHES = 80;
const ADAPTER_LINES = 85;
const BELOW_ADAPTER_LINES = 849;
const BELOW_PURE_LINES = 949;
const CANCELLING_COVERED = 191;
const DECLARATIVE_COUNT = 19;
const LARGE_ADAPTER_BRANCHES = 7_200_000_000_000_000;
const LARGE_ADAPTER_LINES = 7_650_000_000_000_000;
const LARGE_PURE_BRANCHES = 8_100_000_000_000_000;
const LARGE_PURE_LINES = 8_550_000_000_000_000;
const OVER_TOTAL = 101;
const PER_MILLE = 1000;
const PURE_AGGREGATE_BRANCHES = 180;
const PURE_AGGREGATE_LINES = 189;
const PURE_AGGREGATE_TOTAL = 190;
const PURE_BRANCHES = 90;
const PURE_LINES = 95;
const TOTAL = 100;
const TYPE_ONLY = "lib/ts/core/httpClient.ts";
const TYPE_ONLY_METADATA = "lib/ts/npm/metadata.ts";

Deno.test("coverage policy classifies the complete responsibility boundaries", (): void => {
  assertEquals(sourceClassification(PURE), "pure");
  assertEquals(sourceClassification(ADAPTER), "adapter");
  assertEquals(sourceClassification(TYPE_ONLY), "typeOnly");
  assertEquals(sourceClassification(TYPE_ONLY_METADATA), "typeOnly");
  assertEquals(sourceClassification("packages/codeGraph/update.ts"), "adapter");
  assertEquals(sourceClassification("packages/grokBuild/update.ts"), "adapter");
  assertEquals(sourceClassification("packages/actionlint/update.ts"), "declarative");
  assertEquals(Object.keys(DECLARATIVE_SOURCE_ENGINES).length, DECLARATIVE_COUNT);
});

Deno.test("coverage policy proves metadata is compile-erased", async (): Promise<void> => {
  const metadataModule = await import("coolheaded/npm/metadata.ts");
  assertEquals(Object.keys(metadataModule), []);
});

for (const path of ["packages/codeGraph/update.ts", "packages/grokBuild/update.ts"]) {
  Deno.test(`coverage policy protects adapter classification for ${path}`, (): void => {
    const error = assertThrows((): void => {
      validateClassification(path, "declarative");
    });
    assertInstanceOf(error, CoveragePolicyError);
    assertEquals(error.kind, "invalidClassification");
    assertEquals(error.details, { path, rule: "protectedPackageAdapter" });
  });
}

Deno.test("coverage policy accepts exact aggregate thresholds and zero branches", (): void => {
  assertEquals(
    evaluateCoverage(
      [PURE, ADAPTER, TYPE_ONLY, TYPE_ONLY_METADATA],
      [
        source(PURE, [PURE_LINES, TOTAL], [0, 0]),
        source(ADAPTER, [ADAPTER_LINES, TOTAL], [ADAPTER_BRANCHES, TOTAL]),
      ],
    ),
    {
      adapter: {
        branches: { covered: ADAPTER_BRANCHES, total: TOTAL },
        lines: { covered: ADAPTER_LINES, total: TOTAL },
      },
      pure: {
        branches: { covered: 0, total: 0 },
        lines: { covered: PURE_LINES, total: TOTAL },
      },
    },
  );
});

Deno.test("coverage policy rejects runtime coverage for type-only metadata", (): void => {
  const error = assertThrows((): void => {
    evaluateCoverage(
      [PURE, "lib/ts/npm/registry.ts", ADAPTER, TYPE_ONLY_METADATA],
      [
        source(PURE, [PURE_LINES, TOTAL], [0, 0]),
        source(ADAPTER, [ADAPTER_LINES, TOTAL], [ADAPTER_BRANCHES, TOTAL]),
        source(TYPE_ONLY_METADATA, [1, 1], [0, 0]),
      ],
    );
  });
  assertInstanceOf(error, CoveragePolicyError);
  assertEquals(error.kind, "invalidClassification");
  assertEquals(error.details, {
    path: TYPE_ONLY_METADATA,
    rule: "typeOnlyRuntimeRecord",
  });
});

Deno.test("coverage policy uses aggregate counters without per-file thresholds", (): void => {
  evaluateCoverage(
    [PURE, "lib/ts/npm/registry.ts", ADAPTER],
    [
      source(PURE, [1, 10], [0, 10]),
      source(
        "lib/ts/npm/registry.ts",
        [PURE_AGGREGATE_LINES, PURE_AGGREGATE_TOTAL],
        [PURE_AGGREGATE_BRANCHES, PURE_AGGREGATE_TOTAL],
      ),
      source(ADAPTER, [ADAPTER_LINES, TOTAL], [ADAPTER_BRANCHES, TOTAL]),
    ],
  );
});

Deno.test("coverage policy compares large safe counters exactly", (): void => {
  const total = 9_000_000_000_000_000;
  evaluateCoverage(
    [PURE, ADAPTER],
    [
      source(PURE, [LARGE_PURE_LINES, total], [LARGE_PURE_BRANCHES, total]),
      source(ADAPTER, [LARGE_ADAPTER_LINES, total], [LARGE_ADAPTER_BRANCHES, total]),
    ],
  );
});

for (const [name, inventory, records, kind] of [
  [
    "just below pure",
    [PURE, ADAPTER],
    [
      source(PURE, [BELOW_PURE_LINES, PER_MILLE], [PURE_BRANCHES, TOTAL]),
      source(ADAPTER, [ADAPTER_LINES, TOTAL], [ADAPTER_BRANCHES, TOTAL]),
    ],
    "threshold",
  ],
  [
    "just below adapter",
    [PURE, ADAPTER],
    [
      source(PURE, [PURE_LINES, TOTAL], [PURE_BRANCHES, TOTAL]),
      source(ADAPTER, [BELOW_ADAPTER_LINES, PER_MILLE], [ADAPTER_BRANCHES, TOTAL]),
    ],
    "threshold",
  ],
  [
    "missing pure",
    [ADAPTER],
    [source(ADAPTER, [ADAPTER_LINES, TOTAL], [ADAPTER_BRANCHES, TOTAL])],
    "missingCategory",
  ],
  [
    "missing adapter",
    [PURE],
    [source(PURE, [PURE_LINES, TOTAL], [PURE_BRANCHES, TOTAL])],
    "missingCategory",
  ],
  [
    "unloaded",
    [PURE, ADAPTER],
    [source(PURE, [PURE_LINES, TOTAL], [PURE_BRANCHES, TOTAL])],
    "unloadedSources",
  ],
  [
    "unclassified",
    [PURE, ADAPTER, "lib/ts/newRuntime.ts"],
    [
      source(PURE, [PURE_LINES, TOTAL], [PURE_BRANCHES, TOTAL]),
      source(ADAPTER, [ADAPTER_LINES, TOTAL], [ADAPTER_BRANCHES, TOTAL]),
    ],
    "unclassifiedSources",
  ],
] as const) {
  Deno.test(`coverage policy rejects ${name}`, (): void => {
    const error = assertThrows((): void => {
      evaluateCoverage(inventory, records);
    });
    assertInstanceOf(error, CoveragePolicyError);
    assertEquals(error.kind, kind);
  });
}

for (const [name, inventory, records] of [
  [
    "unsafe source counters",
    [PURE, ADAPTER],
    [
      source(PURE, [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1], [0, 0]),
      source(ADAPTER, [ADAPTER_LINES, TOTAL], [ADAPTER_BRANCHES, TOTAL]),
    ],
  ],
  [
    "negative source counters",
    [PURE, ADAPTER],
    [
      source(PURE, [-1, TOTAL], [0, 0]),
      source(ADAPTER, [ADAPTER_LINES, TOTAL], [ADAPTER_BRANCHES, TOTAL]),
    ],
  ],
  [
    "covered greater than total",
    [PURE, ADAPTER],
    [
      source(PURE, [OVER_TOTAL, TOTAL], [0, 0]),
      source(ADAPTER, [ADAPTER_LINES, TOTAL], [ADAPTER_BRANCHES, TOTAL]),
    ],
  ],
  [
    "invalid operands cancelling to valid aggregate",
    [PURE, "lib/ts/npm/registry.ts", ADAPTER],
    [
      source(PURE, [-1, TOTAL], [0, 0]),
      source("lib/ts/npm/registry.ts", [CANCELLING_COVERED, TOTAL], [0, 0]),
      source(ADAPTER, [ADAPTER_LINES, TOTAL], [ADAPTER_BRANCHES, TOTAL]),
    ],
  ],
  [
    "aggregate overflow",
    [PURE, "lib/ts/npm/registry.ts", ADAPTER],
    [
      source(PURE, [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], [0, 0]),
      source("lib/ts/npm/registry.ts", [1, 1], [0, 0]),
      source(ADAPTER, [ADAPTER_LINES, TOTAL], [ADAPTER_BRANCHES, TOTAL]),
    ],
  ],
] as const) {
  Deno.test(`coverage policy rejects ${name}`, (): void => {
    const error = assertThrows((): void => {
      evaluateCoverage(inventory, records);
    });
    assertInstanceOf(error, CoveragePolicyError);
    assertEquals(error.kind, "invalidCoverage");
  });
}
