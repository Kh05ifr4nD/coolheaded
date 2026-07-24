type CoverageCategory = "adapter" | "declarative" | "pure";
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
]);

const DECLARATIVE_SOURCE_ENGINES = {
  "packages/actionlint/update.ts": "releaseHashUpdateProgram",
  "packages/codex/update.ts": "npmPlatformPackageHashUpdateProgram",
  "packages/cue/update.ts": "releaseHashUpdateProgram",
  "packages/deadnix/update.ts": "updateGitHubRustPackagePin",
  "packages/fff/update.ts": "releaseHashUpdateProgram",
  "packages/lazyCodexAi/update.ts": "npmPackageHashUpdateProgram",
  "packages/minerU/update.ts": "updateVersionedNixpkgsPythonUvLock",
  "packages/ohMyPi/update.ts": "releaseHashUpdateProgram",
  "packages/openCode/update.ts": "releaseHashUpdateProgram",
  "packages/openViking/update.ts": "updateGitHubRustPackagePin",
  "packages/oxlint/update.ts": "releaseHashUpdateProgram",
  "packages/rtk/update.ts": "updateGitHubRustPackagePin",
  "packages/rumdl/update.ts": "releaseHashUpdateProgram",
  "packages/semble/update.ts": "updateGitHubSourcePin",
  "packages/shellCheck/update.ts": "releaseHashUpdateProgram",
  "packages/shfmt/update.ts": "releaseHashUpdateProgram",
  "packages/skills/update.ts": "updateNpmTarballPackage",
  "packages/specKit/update.ts": "updateVersionedNixpkgsPythonUvLock",
  "packages/strictDoc/update.ts": "updateVersionedNixpkgsPythonUvLock",
} as const;

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
  "lib/ts/repo/fileSpec.ts": "adapter",
  "lib/ts/repo/fileSpec/check.ts": "adapter",
  "lib/ts/repo/fileSpec/git.ts": "adapter",
  "lib/ts/repo/fileSpec/model.ts": "pure",
  "lib/ts/source/github.ts": "adapter",
  "lib/ts/source/githubVersion.ts": "adapter",
  "lib/ts/source/version.ts": "adapter",
  "lib/ts/system/target.ts": "pure",
  "lib/ts/update/checksumManifest.ts": "adapter",
  "lib/ts/update/release.ts": "adapter",
  "lib/ts/update/rustPackage.ts": "adapter",
  "lib/ts/update/uvLock.ts": "adapter",
};

const PROTECTED_PACKAGE_ADAPTER_PATHS = new Set([
  "packages/codeGraph/update.ts",
  "packages/deno/update.ts",
  "packages/entire/update.ts",
  "packages/grokBuild/update.ts",
  "packages/nixfmt/update.ts",
  "packages/oh-my-openAgent/update.ts",
  "packages/oxfmt/update.ts",
  "packages/paseo/update.ts",
  "packages/qmd/update.ts",
]);

const ADAPTER_BRANCH_THRESHOLD = 80;
const ADAPTER_LINE_THRESHOLD = 85;
const PURE_BRANCH_THRESHOLD = 90;
const PURE_LINE_THRESHOLD = 95;
const THRESHOLDS = {
  adapter: { branches: ADAPTER_BRANCH_THRESHOLD, lines: ADAPTER_LINE_THRESHOLD },
  pure: { branches: PURE_BRANCH_THRESHOLD, lines: PURE_LINE_THRESHOLD },
} as const;

function validateClassification(
  path: string,
  classification: CoverageCategory | "typeOnly" | undefined,
): void {
  if (classification === "declarative" && PROTECTED_PACKAGE_ADAPTER_PATHS.has(path)) {
    throw new CoveragePolicyError("invalidClassification", {
      path,
      rule: "protectedPackageAdapter",
    });
  }
}

function sourceClassification(path: string): CoverageCategory | "typeOnly" | undefined {
  let classification: CoverageCategory | "typeOnly" | undefined = SOURCE_CATEGORIES[path];
  if (TYPE_ONLY_SOURCE_PATHS.has(path)) {
    classification = "typeOnly";
  } else if (Object.hasOwn(DECLARATIVE_SOURCE_ENGINES, path)) {
    classification = "declarative";
  } else if (/^(?:packages\/[^/]+\/update|\.github\/ci\/update\/.*)\.ts$/u.test(path)) {
    classification = "adapter";
  }
  validateClassification(path, classification);
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
    } else if (classification !== "typeOnly") {
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
  for (const [path, category] of classifications) {
    if (category !== "declarative" && (recordByPath.get(path)?.lines.total ?? 0) === 0) {
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

export {
  CoveragePolicyError,
  DECLARATIVE_SOURCE_ENGINES,
  evaluateCoverage,
  sourceClassification,
  validateClassification,
};
export type { SourceCoverage };
