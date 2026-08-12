type CoverageCategory = "adapter" | "pure";
type SourceClassification = CoverageCategory | "excluded" | "typeOnly" | undefined;
type CoverageCounters = Readonly<{ covered: number; total: number }>;
type CategoryCoverage = Readonly<Record<"branches" | "lines", CoverageCounters>>;
type SourceCoverage = Readonly<CategoryCoverage & { path: string }>;
type CoverageSummary = Readonly<Record<"adapter" | "pure", CategoryCoverage>>;

type PolicyErrorKind =
  | "invalidClassification"
  | "invalidCoverage"
  | "missingCategory"
  | "threshold"
  | "unclassifiedSources"
  | "unloadedSources";

class CoveragePolicyError extends Error {
  public readonly details: Readonly<Record<string, unknown>>;
  public readonly kind: PolicyErrorKind;
  public override readonly name = "CoveragePolicyError";
  public constructor(kind: PolicyErrorKind, details: Readonly<Record<string, unknown>>) {
    super(`${kind}: ${JSON.stringify(details)}`);
    this.details = details;
    this.kind = kind;
  }
}

const TYPE_ONLY_SOURCE_PATHS = new Set([
  "lib/ts/core/commandRunner.ts",
  "lib/ts/core/httpClient.ts",
  "lib/ts/npm/metadata.ts",
  "lib/ts/repo/layout/types.ts",
]);

const SOURCE_CATEGORIES: Readonly<Record<string, "adapter" | "pure">> = {
  ".github/ci/coverage.ts": "adapter",
  ".github/ci/coveragePolicy.ts": "pure",
  ".github/ci/impact.ts": "adapter",
  ".github/ci/model.ts": "pure",
  ".github/ci/process.ts": "adapter",
  "lib/ts/core/denoCommandRunner.ts": "adapter",
  "lib/ts/core/fetchHttpClient.ts": "adapter",
  "lib/ts/core/temporaryDirectory.ts": "adapter",
  "lib/ts/core/updateScript.ts": "adapter",
  "lib/ts/core/version.ts": "pure",
  "lib/ts/npm/lock.ts": "adapter",
  "lib/ts/npm/metadataError.ts": "pure",
  "lib/ts/npm/packageHash.ts": "adapter",
  "lib/ts/npm/platformHash.ts": "adapter",
  "lib/ts/npm/registry.ts": "pure",
  "lib/ts/npm/tarball.ts": "adapter",
  "lib/ts/pin/json.ts": "adapter",
  "lib/ts/pin/packageHashConfig.ts": "pure",
  "lib/ts/pin/sriHash.ts": "pure",
  "lib/ts/repo/denoSnapshot.ts": "adapter",
  "lib/ts/repo/layout.ts": "adapter",
  "lib/ts/repo/layout/check.ts": "adapter",
  "lib/ts/repo/layout/command.ts": "adapter",
  "lib/ts/repo/layout/git.ts": "adapter",
  "lib/ts/repo/layout/model.ts": "pure",
  "lib/ts/source/github.ts": "adapter",
  "lib/ts/source/githubVersion.ts": "adapter",
  "lib/ts/source/version.ts": "adapter",
  "lib/ts/system/target.ts": "pure",
  "lib/ts/update/checksumManifest.ts": "adapter",
  "lib/ts/update/release.ts": "adapter",
  "lib/ts/update/rustPackage.ts": "adapter",
  "lib/ts/update/uvLock.ts": "adapter",
};

const ADAPTER_BRANCH_THRESHOLD = 80;
const ADAPTER_LINE_THRESHOLD = 85;
const PURE_BRANCH_THRESHOLD = 90;
const PURE_LINE_THRESHOLD = 95;
const THRESHOLDS = {
  adapter: { branches: ADAPTER_BRANCH_THRESHOLD, lines: ADAPTER_LINE_THRESHOLD },
  pure: { branches: PURE_BRANCH_THRESHOLD, lines: PURE_LINE_THRESHOLD },
} as const;

function sourceClassification(path: string): SourceClassification {
  let classification: SourceClassification = SOURCE_CATEGORIES[path];
  if (TYPE_ONLY_SOURCE_PATHS.has(path)) {
    classification = "typeOnly";
  } else if (/^packages\/[^/]+\/update\.ts$/u.test(path)) {
    classification = "excluded";
  } else if (/^\.github\/ci\/update\/.*\.ts$/u.test(path)) {
    classification = "adapter";
  }
  return classification;
}

function countersAreValid(counters: CoverageCounters): boolean {
  return (
    Number.isSafeInteger(counters.covered) &&
    Number.isSafeInteger(counters.total) &&
    counters.covered >= 0 &&
    counters.total >= 0 &&
    counters.covered <= counters.total
  );
}

function addCounters(left: CoverageCounters, right: CoverageCounters): CoverageCounters {
  const result = { covered: left.covered + right.covered, total: left.total + right.total };
  if (!countersAreValid(left) || !countersAreValid(right) || !countersAreValid(result)) {
    throw new CoveragePolicyError("invalidCoverage", { left, right });
  }
  return result;
}

function categoryCoverage(
  category: "adapter" | "pure",
  records: readonly SourceCoverage[],
  classifications: Readonly<Map<string, CoverageCategory>>,
): CategoryCoverage {
  const sources = records.filter((record) => classifications.get(record.path) === category);
  if (sources.every((source: Readonly<SourceCoverage>) => source.lines.total === 0)) {
    throw new CoveragePolicyError("missingCategory", { category });
  }
  let coverage: CategoryCoverage = {
    branches: { covered: 0, total: 0 },
    lines: { covered: 0, total: 0 },
  };
  for (const source of sources) {
    coverage = {
      branches: addCounters(coverage.branches, source.branches),
      lines: addCounters(coverage.lines, source.lines),
    };
  }
  return coverage;
}

function meetsThreshold(counters: CoverageCounters, required: number): boolean {
  return (
    counters.total === 0 ||
    BigInt(counters.covered) * 100n >= BigInt(required) * BigInt(counters.total)
  );
}

function evaluateCoverage(
  inventory: readonly string[],
  records: readonly SourceCoverage[],
): CoverageSummary {
  const classifications = new Map<string, CoverageCategory>();
  const unclassified: string[] = [];
  for (const path of inventory) {
    const classification = sourceClassification(path);
    if (classification === undefined) {
      unclassified.push(path);
    } else if (classification === "adapter" || classification === "pure") {
      classifications.set(path, classification);
    }
  }
  if (unclassified.length > 0) {
    throw new CoveragePolicyError("unclassifiedSources", { paths: unclassified.toSorted() });
  }
  const runtimeTypeOnly = records.find(
    (record: Readonly<SourceCoverage>) => sourceClassification(record.path) === "typeOnly",
  );
  if (runtimeTypeOnly !== undefined) {
    throw new CoveragePolicyError("invalidClassification", {
      path: runtimeTypeOnly.path,
      rule: "typeOnlyRuntimeRecord",
    });
  }

  const recordByPath = new Map(records.map((record) => [record.path, record]));
  const unloaded: string[] = [];
  for (const path of classifications.keys()) {
    if ((recordByPath.get(path)?.lines.total ?? 0) === 0) {
      unloaded.push(path);
    }
  }
  if (unloaded.length > 0) {
    throw new CoveragePolicyError("unloadedSources", { paths: unloaded.toSorted() });
  }

  const summary = {
    adapter: categoryCoverage("adapter", records, classifications),
    pure: categoryCoverage("pure", records, classifications),
  };

  for (const category of ["adapter", "pure"] as const) {
    for (const metric of ["branches", "lines"] as const) {
      const counters = summary[category][metric];
      const required = THRESHOLDS[category][metric];
      if (!meetsThreshold(counters, required)) {
        throw new CoveragePolicyError("threshold", {
          actual: counters,
          category,
          metric,
          required,
        });
      }
    }
  }
  return summary;
}

export { CoveragePolicyError, evaluateCoverage, sourceClassification };
export type { SourceClassification, SourceCoverage };
