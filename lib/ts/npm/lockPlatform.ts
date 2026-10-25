import { SYSTEM_TARGETS } from "coolheaded/system/target.ts";

type JsonRecord = Readonly<Record<string, unknown>>;

interface NpmPlatform {
  readonly cpu: string;
  readonly os: string;
}

const NODE_MODULES_SEGMENT = "node_modules/";
const LINUX_LIBC = "glibc";
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const satisfies readonly string[];
const RESOLVED_DEPENDENCY_FIELDS: readonly string[] = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
];

const SUPPORTED_NPM_PLATFORMS: readonly NpmPlatform[] = SYSTEM_TARGETS.map(
  ({ npmReleaseTarget }): NpmPlatform => {
    const [os = "", cpu = ""] = npmReleaseTarget.split("-");
    return { cpu, os };
  },
);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item: unknown): item is string => typeof item === "string")
    : [];
}

function constraintAllows(constraint: unknown, value: string): boolean {
  const entries = stringList(constraint);
  const allowed = entries.filter((entry: string): boolean => !entry.startsWith("!"));
  return !entries.includes(`!${value}`) && (allowed.length === 0 || allowed.includes(value));
}

function supportsPlatform(entry: JsonRecord, platform: NpmPlatform): boolean {
  return (
    constraintAllows(entry["os"], platform.os) &&
    constraintAllows(entry["cpu"], platform.cpu) &&
    (platform.os !== "linux" || constraintAllows(entry["libc"], LINUX_LIBC))
  );
}

function supportsAnyPlatform(entry: JsonRecord): boolean {
  return SUPPORTED_NPM_PLATFORMS.some((platform: NpmPlatform): boolean =>
    supportsPlatform(entry, platform),
  );
}

function packageName(path: string): string {
  const index = path.lastIndexOf(NODE_MODULES_SEGMENT);
  return index === -1 ? path : path.slice(index + NODE_MODULES_SEGMENT.length);
}

function dependencyNames(entry: JsonRecord): readonly string[] {
  return DEPENDENCY_FIELDS.flatMap((field: string): readonly string[] => {
    const dependencies = entry[field];
    return isRecord(dependencies) ? Object.keys(dependencies) : [];
  });
}

function reachableEntries(
  entries: readonly (readonly [string, JsonRecord])[],
): ReadonlyMap<string, JsonRecord> {
  const referenced = new Set<string>();
  let kept = new Map<string, JsonRecord>();
  let previousSize = -1;
  while (kept.size !== previousSize) {
    previousSize = kept.size;
    kept = new Map(
      entries.filter(
        ([path, entry]: readonly [string, JsonRecord]): boolean =>
          path === "" || entry["inBundle"] === true || referenced.has(packageName(path)),
      ),
    );
    for (const entry of kept.values()) {
      for (const name of dependencyNames(entry)) {
        referenced.add(name);
      }
    }
  }
  return kept;
}

function ancestorPaths(path: string): readonly string[] {
  const ancestors = [path];
  let current = path;
  while (current !== "") {
    const index = current.lastIndexOf(NODE_MODULES_SEGMENT);
    const prefix = current.slice(0, index);
    current = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    ancestors.push(current);
  }
  return ancestors;
}

function resolvableDependency(paths: readonly string[], path: string, name: string): boolean {
  return ancestorPaths(path).some((base: string): boolean =>
    paths.includes(`${base}${base === "" ? "" : "/"}${NODE_MODULES_SEGMENT}${name}`),
  );
}

function supportedLockEntry(paths: readonly string[], path: string, entry: JsonRecord): JsonRecord {
  const result: Record<string, unknown> = { ...entry };
  for (const field of RESOLVED_DEPENDENCY_FIELDS) {
    const dependencies = entry[field];
    if (isRecord(dependencies)) {
      result[field] = Object.fromEntries(
        Object.entries(dependencies).filter(([name]: readonly [string, unknown]): boolean =>
          resolvableDependency(paths, path, name),
        ),
      );
    }
  }
  return result;
}

function supportedPackageLock(packageLockText: string): string {
  const packageLock: unknown = JSON.parse(packageLockText);
  if (!isRecord(packageLock) || !isRecord(packageLock["packages"])) {
    return packageLockText;
  }
  const platformEntries = Object.entries(packageLock["packages"]).filter(
    (pair: readonly [string, unknown]): pair is [string, JsonRecord] =>
      isRecord(pair[1]) && supportsAnyPlatform(pair[1]),
  );
  const kept = reachableEntries(platformEntries);
  const keptPaths = [...kept.keys()];
  const packages = Object.fromEntries(
    [...kept].map(([path, entry]: readonly [string, JsonRecord]): readonly [string, JsonRecord] => [
      path,
      supportedLockEntry(keptPaths, path, entry),
    ]),
  );
  return `${JSON.stringify({ ...packageLock, packages }, undefined, 2)}\n`;
}

export { SUPPORTED_NPM_PLATFORMS, supportedPackageLock };
export type { NpmPlatform };
