import {
  EXECUTABLE_MODE,
  requiredToolPath,
  runFileSpecErrorProbe,
  withTemporaryDirectory,
  writeRepositoryFixture,
} from "./fixture.ts";
import { assertEquals, assertInstanceOf, assertStrictEquals } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import { assertType } from "@jsr/std__testing/types";
import { changedSnapshotComponents } from "coolheaded/repo/fileSpec/check.ts";
import { repositorySnapshot } from "coolheaded/repo/fileSpec/git.ts";
import { snapshotChangedError } from "coolheaded/repo/fileSpec/model.ts";

type RepositorySnapshot = Parameters<typeof changedSnapshotComponents>[0];
type SnapshotChangedComponent = ReturnType<typeof changedSnapshotComponents>[number];
type ToolIdentity = RepositorySnapshot["tools"]["cue"];

const COMPONENTS = [
  "enumerationSha256",
  "fileSpecSha256",
  "head",
  "ignoreSourcesSha256",
  "indexTree",
  "tools.cue.executable",
  "tools.cue.version",
  "tools.cue.sha256",
  "tools.deno.executable",
  "tools.deno.version",
  "tools.deno.sha256",
  "tools.git.executable",
  "tools.git.version",
  "tools.git.sha256",
] as const satisfies readonly SnapshotChangedComponent[];
assertType<
  Exclude<SnapshotChangedComponent, (typeof COMPONENTS)[number]> extends never ? true : false
>(true);
type SnapshotShapeComponent =
  | Exclude<keyof RepositorySnapshot, "tools">
  | `tools.${keyof RepositorySnapshot["tools"]}.${keyof ToolIdentity}`;
assertType<Exclude<SnapshotShapeComponent, SnapshotChangedComponent> extends never ? true : false>(
  true,
);
assertType<Exclude<SnapshotChangedComponent, SnapshotShapeComponent> extends never ? true : false>(
  true,
);

const TOOLS = {
  cue: { executable: "/cue", sha256: "cue-sha", version: "cue-version" },
  deno: { executable: "/deno", sha256: "deno-sha", version: "deno-version" },
  git: { executable: "/git", sha256: "git-sha", version: "git-version" },
} as const satisfies Readonly<Record<"cue" | "deno" | "git", ToolIdentity>>;

const SNAPSHOT = {
  enumerationSha256: "enumeration",
  fileSpecSha256: "file-spec",
  head: "head",
  ignoreSourcesSha256: "ignore",
  indexTree: "index",
  tools: TOOLS,
} as const satisfies RepositorySnapshot;

function changedSnapshot(component: SnapshotChangedComponent): RepositorySnapshot {
  if (component.startsWith("tools.")) {
    const [, command, field] = component.split(".");
    if (
      (command === "cue" || command === "deno" || command === "git") &&
      (field === "executable" || field === "version" || field === "sha256")
    ) {
      return {
        ...SNAPSHOT,
        tools: {
          ...TOOLS,
          [command]: { ...TOOLS[command], [field]: `${TOOLS[command][field]}-changed` },
        },
      };
    }
  }

  if (
    component === "enumerationSha256" ||
    component === "fileSpecSha256" ||
    component === "head" ||
    component === "ignoreSourcesSha256" ||
    component === "indexTree"
  ) {
    return { ...SNAPSHOT, [component]: `${SNAPSHOT[component]}-changed` };
  }

  throw new Error(`unknown snapshot component: ${component}`);
}

async function executableSha256(executable: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await Deno.readFile(executable));
  return Array.from(new Uint8Array(digest), (byte: number): string =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function executableVersion(executable: string, args: readonly string[]): Promise<string> {
  const output = await new Deno.Command(executable, { args: [...args] }).output();
  assertEquals(output.success, true);
  return new globalThis.TextDecoder().decode(output.stdout).trim();
}

describe("snapshot identity", (): void => {
  it("constructs exact snapshot change errors", (): void => {
    const changedComponents: readonly SnapshotChangedComponent[] = ["head"];
    const error = snapshotChangedError("before", "after", changedComponents);

    assertInstanceOf(error, Error);
    assertEquals(error.message, "repository changed while fileSpec was being checked");
    assertEquals(error.kind, "snapshotChanged");
    assertEquals(error.name, "SnapshotChangedError");
    assertEquals(error.beforeFingerprint, "before");
    assertEquals(error.afterFingerprint, "after");
    assertStrictEquals(error.changedComponents, changedComponents);
  });

  it("attributes every changed component exactly", (): void => {
    for (const component of COMPONENTS) {
      assertEquals(changedSnapshotComponents(SNAPSHOT, changedSnapshot(component)), [component]);
    }
  });

  it("acquires actual tool executables, versions, and digests", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await writeRepositoryFixture(repositoryRoot);
      const snapshot = await repositorySnapshot(repositoryRoot, {
        ignoredPaths: [],
        indexPaths: [".gitignore", "fileSpec.cue"],
        visiblePaths: [],
      });

      assertEquals(snapshot.tools.deno.executable, Deno.execPath());
      assertEquals(snapshot.tools.deno.version, Deno.version.deno);
      assertEquals(snapshot.tools.deno.sha256, await executableSha256(Deno.execPath()));
      await Promise.all(
        (
          [
            ["cue", "COOLHEADED_CUE", ["version"]],
            ["git", "COOLHEADED_GIT", ["--version"]],
          ] as const
        ).map(async ([command, environmentVariable, versionArgs]): Promise<void> => {
          const executable = requiredToolPath(environmentVariable);
          assertEquals(snapshot.tools[command].executable, executable);
          assertEquals(
            snapshot.tools[command].version,
            await executableVersion(executable, versionArgs),
          );
          assertEquals(snapshot.tools[command].sha256, await executableSha256(executable));
        }),
      );
    });
  });

  it("attributes a real mid-check fileSpec mutation", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      const stateRoot = await Deno.makeTempDir({ prefix: "coolheaded-snapshot-state-" });
      const wrapperPath = `${repositoryRoot}/wrapper`;
      const originalCue = requiredToolPath("COOLHEADED_CUE");
      try {
        await writeRepositoryFixture(repositoryRoot, { gitignore: "wrapper\n" });
        await Deno.writeTextFile(
          wrapperPath,
          `#!/bin/sh
state=${JSON.stringify(`${stateRoot}/changed`)}
if [ "$1" = "vet" ] && [ ! -f "$state" ]; then
  printf "\\n" >> ${JSON.stringify(`${repositoryRoot}/fileSpec.cue`)}
  touch "$state"
fi
exec ${JSON.stringify(originalCue)} "$@"
`,
        );
        await Deno.chmod(wrapperPath, EXECUTABLE_MODE);
        const error = await runFileSpecErrorProbe(repositoryRoot, wrapperPath);
        assertEquals(error["kind"], "snapshotChanged", JSON.stringify(error));
        assertEquals(error["changedComponents"], ["fileSpecSha256"]);
      } finally {
        await Deno.remove(stateRoot, { recursive: true });
      }
    });
  });
});
