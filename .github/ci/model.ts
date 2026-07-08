const DENO_SNAPSHOT_CHECK = "denoDependencies";

type ActivatedCheckKind = "denoSnapshot" | "package";
type UpdateLaneKind = "denoDependencies" | "flakeInput" | "package";

interface ActivatedCheck {
  readonly kind: ActivatedCheckKind;
  readonly name: string;
  readonly runner: string;
  readonly system: string;
}

interface UpdateLane {
  readonly currentVersion: string;
  readonly kind: UpdateLaneKind;
  readonly name: string;
}

function activatedCheckKind(name: string): ActivatedCheckKind {
  return name === DENO_SNAPSHOT_CHECK ? "denoSnapshot" : "package";
}

function activatedCheck(name: string, runner: string, system: string): ActivatedCheck {
  return {
    kind: activatedCheckKind(name),
    name,
    runner,
    system,
  };
}

export { DENO_SNAPSHOT_CHECK, activatedCheck, activatedCheckKind };
export type { ActivatedCheck, ActivatedCheckKind, UpdateLane, UpdateLaneKind };
