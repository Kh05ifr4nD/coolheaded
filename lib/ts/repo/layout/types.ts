type ConformanceViolation = Error &
  Readonly<{
    readonly kind: "conformance";
  }>;

type InputDecodeError = Error &
  Readonly<{
    readonly kind: "inputDecode";
    readonly source: string;
  }>;

type InternalInvariantError = Error &
  Readonly<{
    readonly kind: "internalInvariant";
  }>;

type LayoutCommand = "cue" | "git";

type ToolExecutionError = Error &
  Readonly<{
    readonly args: readonly string[];
    readonly command: string;
    readonly executable: string;
    readonly exitCode: number | undefined;
    readonly kind: "toolExecution";
    readonly stderr: string;
  }>;

type ToolIdentity = Readonly<{
  readonly executable: string;
  readonly sha256: string;
  readonly version: string;
}>;

type RepositorySnapshot = Readonly<{
  readonly enumerationSha256: string;
  readonly layoutSha256: string;
  readonly head: string;
  readonly indexTree: string;
  readonly tools: Readonly<Record<LayoutCommand | "deno", ToolIdentity>>;
}>;

type SnapshotChangedComponent =
  | "enumerationSha256"
  | "layoutSha256"
  | "head"
  | "indexTree"
  | `tools.${LayoutCommand | "deno"}.${keyof ToolIdentity}`;

type SnapshotChangedError = Error &
  Readonly<{
    readonly afterFingerprint: string;
    readonly beforeFingerprint: string;
    readonly changedComponents: readonly SnapshotChangedComponent[];
    readonly kind: "snapshotChanged";
  }>;

type LayoutError =
  | ConformanceViolation
  | InputDecodeError
  | InternalInvariantError
  | SnapshotChangedError
  | ToolExecutionError;

type LayoutNode = true | Layout;

interface Layout {
  readonly [name: string]: LayoutNode;
}

export type {
  ConformanceViolation,
  InputDecodeError,
  InternalInvariantError,
  Layout,
  LayoutCommand,
  LayoutError,
  LayoutNode,
  RepositorySnapshot,
  SnapshotChangedComponent,
  SnapshotChangedError,
  ToolExecutionError,
  ToolIdentity,
};
