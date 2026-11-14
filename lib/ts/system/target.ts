import systemConfig from "./targets.json" with { type: "json" };

const SUPPORTED_SYSTEMS = ["aarch64-darwin", "aarch64-linux", "x86_64-linux"] as const;

type SupportedSystem = (typeof SUPPORTED_SYSTEMS)[number];

interface SystemTarget {
  readonly npmReleaseTarget: string;
  readonly pythonEnvironmentMarker: string;
  readonly runner: string;
  readonly rustTargetTriple: string;
  readonly system: SupportedSystem;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSupportedSystem(value: string): value is SupportedSystem {
  return (SUPPORTED_SYSTEMS as readonly string[]).includes(value);
}

function parsePackageSystems(value: unknown): readonly SupportedSystem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("Package systems must be a non-empty array");
  }

  const values: readonly unknown[] = value;
  const systems: SupportedSystem[] = [];
  for (const system of values) {
    if (typeof system !== "string" || !isSupportedSystem(system)) {
      throw new TypeError(`Unsupported package system: ${String(system)}`);
    }
    if (systems.includes(system)) {
      throw new TypeError(`Duplicate package system: ${system}`);
    }
    systems.push(system);
  }
  return systems;
}

function parseSystemTarget(value: unknown): SystemTarget {
  if (!isRecord(value)) {
    throw new TypeError("Invalid system target");
  }

  const { npmReleaseTarget, pythonEnvironmentMarker, runner, rustTargetTriple, system } = value;

  if (
    typeof npmReleaseTarget !== "string" ||
    typeof pythonEnvironmentMarker !== "string" ||
    typeof runner !== "string" ||
    typeof rustTargetTriple !== "string" ||
    typeof system !== "string" ||
    !isSupportedSystem(system)
  ) {
    throw new TypeError("Invalid system target");
  }

  return {
    npmReleaseTarget,
    pythonEnvironmentMarker,
    runner,
    rustTargetTriple,
    system,
  };
}

function parseSystemTargets(value: unknown): readonly SystemTarget[] {
  const targets = isRecord(value) ? value["targets"] : undefined;
  if (!Array.isArray(targets)) {
    throw new TypeError("Invalid system target config");
  }

  return targets.map((target: unknown): SystemTarget => parseSystemTarget(target));
}

const SYSTEM_TARGETS = parseSystemTargets(systemConfig);
export { SUPPORTED_SYSTEMS, SYSTEM_TARGETS, isSupportedSystem, parsePackageSystems };
export type { SupportedSystem, SystemTarget };
