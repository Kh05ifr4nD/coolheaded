import {
  EXECUTABLE_MODE,
  requiredToolPath,
  runFileSpecChecker,
  runFileSpecErrorProbe,
  withTemporaryDirectory,
  writeRepositoryFixture,
} from "./fixture.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import { checkFileSpec } from "coolheaded/repo/fileSpec/check.ts";
import { join } from "@jsr/std__path";

const CANDIDATE_COUNT = 17;
const CUE_FAILURE_EXIT_CODE = 23;

function candidatePath(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("candidate fileSpec must be an object");
  }
  const hidden = "hidden" in value ? value.hidden : undefined;
  if (typeof hidden !== "object" || hidden === null || Array.isArray(hidden)) {
    throw new Error("candidate fileSpec must contain hidden paths");
  }
  const paths = Object.entries(hidden)
    .filter((entry: readonly [string, unknown]): boolean => entry[1] === true)
    .map((entry: readonly [string, unknown]): string => `hidden/${entry[0]}`);
  if (paths.length !== 1) {
    throw new Error("candidate fileSpec must contain exactly one path");
  }
  const [path] = paths;
  if (path === undefined) {
    throw new Error("candidate path is missing");
  }
  return path;
}

describe("ignored path hardening", (): void => {
  it("rejects an ignored admitted file", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await writeRepositoryFixture(repositoryRoot, {
        files: [{ contents: "export {};\n", path: "hidden/allowed.ts" }],
        gitignore: "hidden/\n",
        pathFields: '\thidden?: {\n\t\t"allowed.ts"?: #RegularFile\n\t}',
      });

      await assertRejects(
        (): Promise<void> => checkFileSpec(repositoryRoot),
        Error,
        "hidden/allowed.ts",
      );
    });
  });

  it("rejects ignored sibling combinations admitted together", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await writeRepositoryFixture(repositoryRoot, {
        files: [
          { contents: "export {};\n", path: "hidden/a.ts" },
          { contents: "export {};\n", path: "hidden/b.ts" },
        ],
        gitignore: "hidden/\n",
        pathFields: '\thidden?: {\n\t\t"a.ts"?: #RegularFile\n\t\t"b.ts"?: #RegularFile\n\t}',
        requiredFields: '\thidden?: {\n\t\t"a.ts"!: #RegularFile\n\t\t"b.ts"!: #RegularFile\n\t}',
      });

      const error = await assertRejects((): Promise<void> => checkFileSpec(repositoryRoot));
      assertInstanceOf(error, Error);
      assertEquals(error.message.includes("hidden/a.ts"), true);
      assertEquals(error.message.includes("hidden/b.ts"), true);
    });
  });

  it("fails closed when a delegated CUE check fails", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await writeRepositoryFixture(repositoryRoot, {
        files: [{ contents: "export {};\n", path: "hidden/allowed.ts" }],
        gitignore: "hidden/\nwrapper\n",
        pathFields: '\thidden?: {\n\t\t"allowed.ts"?: #RegularFile\n\t}',
      });
      const wrapperPath = join(repositoryRoot, "wrapper");
      await Deno.writeTextFile(
        wrapperPath,
        `#!/bin/sh
if [ "$1" = "vet" ] && [ "$5" = "#FileSpecPath" ]; then exit ${CUE_FAILURE_EXIT_CODE}; fi
exec ${JSON.stringify(requiredToolPath("COOLHEADED_CUE"))} "$@"
`,
      );
      await Deno.chmod(wrapperPath, EXECUTABLE_MODE);

      const error = await runFileSpecErrorProbe(repositoryRoot, wrapperPath);

      assertEquals(error["kind"], "toolExecution", JSON.stringify(error));
      assertEquals(error["command"], "cue");
      assertEquals(error["executable"], wrapperPath);
      assertEquals(error["exitCode"], CUE_FAILURE_EXIT_CODE);
      const { args } = error;
      assertEquals(Array.isArray(args), true);
      if (!Array.isArray(args)) {
        throw new TypeError("tool error args must be an array");
      }
      assertEquals(args[0], "vet");
      assertEquals(args[1], `${repositoryRoot}/fileSpec.cue`);
      assertEquals(args[3], "-d");
      assertEquals(args[4], "#FileSpecPath");
    });
  });

  it("checks a real large ignored tree with bounded CUE concurrency", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      const stateRoot = await Deno.makeTempDir({ prefix: "coolheaded-cue-events-" });
      const originalPath = Deno.env.get("PATH") ?? "";
      try {
        const files = Array.from({ length: CANDIDATE_COUNT }, (_value, index) => ({
          contents: `export const value = ${index};\n`,
          path: `hidden/candidate${index}.ts`,
        }));
        await writeRepositoryFixture(repositoryRoot, {
          files,
          gitignore: "hidden/\n",
        });
        const decoyRoot = join(stateRoot, "decoy");
        const decoyMarker = join(stateRoot, "path-decoy-called");
        await Deno.mkdir(decoyRoot);
        await Promise.all(
          ["cue", "git"].map(async (command: string): Promise<void> => {
            const decoyPath = join(decoyRoot, command);
            await Deno.writeTextFile(
              decoyPath,
              `#!/bin/sh\ntouch ${JSON.stringify(decoyMarker)}\nexit 31\n`,
            );
            await Deno.chmod(decoyPath, EXECUTABLE_MODE);
          }),
        );
        const wrapperPath = join(stateRoot, "wrapper");
        await Deno.writeTextFile(
          wrapperPath,
          `#!/bin/sh
state=${JSON.stringify(stateRoot)}
if [ "$1" != "vet" ] || [ "$4" != "-d" ] || [ "$5" != "#FileSpecPath" ]; then
  exec ${JSON.stringify(requiredToolPath("COOLHEADED_CUE"))} "$@"
fi
id=$$
mkdir "$state/active-$id"
cp "$3" "$state/candidate-$id.json"
count=0
for activePath in "$state"/active-*; do
  if [ -d "$activePath" ]; then count=$((count + 1)); fi
done
touch "$state/active-count-$count-$id"
if [ ! -f "$state/release" ]; then
  if [ "$count" -ge 8 ]; then
    touch "$state/release"
  else
    attempt=0
    while [ ! -f "$state/release" ] && [ "$attempt" -lt 100000 ]; do
      attempt=$((attempt + 1))
    done
    if [ ! -f "$state/release" ]; then
      rm -r "$state/active-$id"
      exit 24
    fi
  fi
fi
${JSON.stringify(requiredToolPath("COOLHEADED_CUE"))} "$@"
status=$?
rm -r "$state/active-$id"
exit "$status"
`,
        );
        await Deno.chmod(wrapperPath, EXECUTABLE_MODE);
        Deno.env.set("PATH", `${decoyRoot}:${originalPath}`);

        const output = await runFileSpecChecker(repositoryRoot, wrapperPath);
        const events = await Array.fromAsync(Deno.readDir(stateRoot));
        const candidates = events.filter((entry: Readonly<Deno.DirEntry>) =>
          entry.name.startsWith("candidate-"),
        );
        const activeCounts = events
          .filter((entry: Readonly<Deno.DirEntry>) => entry.name.startsWith("active-count-"))
          .map((entry: Readonly<Deno.DirEntry>) => Number(entry.name.split("-")[2]));
        const observedPaths = await Promise.all(
          candidates.map(async (entry: Readonly<Deno.DirEntry>): Promise<string> => {
            const contents = await Deno.readTextFile(join(stateRoot, entry.name));
            return candidatePath(JSON.parse(contents));
          }),
        );
        const expectedPaths = files
          .map((file: Readonly<{ readonly path: string }>): string => file.path)
          .toSorted();

        assertEquals(output.success, true, output.stderr);
        assertEquals(observedPaths.toSorted(), expectedPaths);
        assertEquals(new Set(observedPaths).size, CANDIDATE_COUNT);
        assertEquals(Math.max(...activeCounts), 8);
        assertEquals(
          activeCounts.every((count) => count <= 8),
          true,
        );
        await assertRejects(
          (): Promise<Deno.FileInfo> => Deno.stat(decoyMarker),
          Deno.errors.NotFound,
        );
      } finally {
        Deno.env.set("PATH", originalPath);
        await Deno.remove(stateRoot, { recursive: true });
      }
    });
  });
});
