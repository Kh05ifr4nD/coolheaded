import systemConfig from "./targets.json" with { type: "json" };

const SUPPORTED_SYSTEMS = ["aarch64-darwin", "aarch64-linux", "x86_64-linux"] as const;

type SupportedSystem = (typeof SUPPORTED_SYSTEMS)[number];

interface SystemTarget {
  readonly npmReleaseTarget: string;
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

function parseSystemTarget(value: unknown): SystemTarget {
  if (!isRecord(value)) {
    throw new TypeError("Invalid system target");
  }

  const { npmReleaseTarget, runner, rustTargetTriple, system } = value;

  if (
    typeof npmReleaseTarget !== "string" ||
    typeof runner !== "string" ||
    typeof rustTargetTriple !== "string" ||
    typeof system !== "string" ||
    !isSupportedSystem(system)
  ) {
    throw new TypeError("Invalid system target");
  }

  return {
    npmReleaseTarget,
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

function systemRecord<Value>(
  valueForSystem: (system: SupportedSystem) => Value,
): Readonly<Record<SupportedSystem, Value>> {
  const [darwinArm64System, linuxArm64System, linuxX64System] = SUPPORTED_SYSTEMS;

  return {
    [darwinArm64System]: valueForSystem(darwinArm64System),
    [linuxArm64System]: valueForSystem(linuxArm64System),
    [linuxX64System]: valueForSystem(linuxX64System),
  };
}

export { SUPPORTED_SYSTEMS, SYSTEM_TARGETS, systemRecord };
export type { SupportedSystem, SystemTarget };
