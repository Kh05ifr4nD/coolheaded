import {
  MAX_CONCURRENT_FILE_SPEC_PROCESSES,
  mapWithConcurrency,
  validateGitPathNames,
} from "coolheaded/repo/fileSpec/git.ts";
import { assertEquals, assertRejects } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import { checkFileSpec } from "coolheaded/repo/fileSpec/check.ts";
import { join } from "@jsr/std__path";
import { serializePinJson } from "coolheaded/pin/json.ts";

type PinJsonConfig = Parameters<typeof serializePinJson>[0];

const PACKAGES_DIRECTORY_PATH = new globalThis.URL("../../../packages/", import.meta.url).pathname;
const REPOSITORY_ROOT_PATH = new globalThis.URL("../../../", import.meta.url).pathname;
const CONCURRENCY_TEST_ITEM_COUNT = 17;
const EXECUTABLE_MODE = 0o755;

async function packageDirectories(): Promise<readonly string[]> {
  const entries = await Array.fromAsync(Deno.readDir(PACKAGES_DIRECTORY_PATH));

  return entries
    .filter((entry: Readonly<Deno.DirEntry>): boolean => entry.isDirectory)
    .map((entry: Readonly<Deno.DirEntry>): string => entry.name)
    .toSorted();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch (error: unknown) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }

    throw error;
  }
}

function requiredToolPath(environmentVariable: string): string {
  const value = Deno.env.get(environmentVariable);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${environmentVariable} is not set; run tests in nix develop`);
  }

  return value;
}

async function runGit(repositoryRoot: string, args: readonly string[]): Promise<void> {
  const output = await new Deno.Command(requiredToolPath("COOLHEADED_GIT"), {
    args: [...args],
    clearEnv: true,
    cwd: repositoryRoot,
    env: { PATH: Deno.env.get("PATH") ?? "" },
    stderr: "piped",
    stdout: "piped",
  }).output();

  if (!output.success) {
    const stderr = new globalThis.TextDecoder().decode(output.stderr).trim();
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

async function runGitWithInput(
  repositoryRoot: string,
  args: readonly string[],
  input: string,
): Promise<string> {
  const process = new Deno.Command(requiredToolPath("COOLHEADED_GIT"), {
    args: [...args],
    clearEnv: true,
    cwd: repositoryRoot,
    env: { PATH: Deno.env.get("PATH") ?? "" },
    stderr: "piped",
    stdin: "piped",
    stdout: "piped",
  }).spawn();
  const writer = process.stdin.getWriter();
  await writer.write(new globalThis.TextEncoder().encode(input));
  await writer.close();
  const output = await process.output();

  if (!output.success) {
    const stderr = new globalThis.TextDecoder().decode(output.stderr).trim();
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }

  return new globalThis.TextDecoder().decode(output.stdout);
}

type FileSpecCheckerOutput = Readonly<{
  readonly stderr: string;
  readonly success: boolean;
}>;

async function runFileSpecChecker(
  repositoryRoot: string,
  cuePath: string,
): Promise<FileSpecCheckerOutput> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--no-check",
      "--allow-env=PATH,COOLHEADED_CUE,COOLHEADED_GIT",
      "--allow-read",
      "--allow-run",
      "--allow-write",
      join(REPOSITORY_ROOT_PATH, "lib/ts/repo/fileSpec.ts"),
    ],
    clearEnv: true,
    cwd: repositoryRoot,
    env: {
      COOLHEADED_CUE: cuePath,
      COOLHEADED_GIT: requiredToolPath("COOLHEADED_GIT"),
      PATH: Deno.env.get("PATH") ?? "",
    },
    stderr: "piped",
    stdout: "piped",
  });
  const output = await command.output();

  return {
    stderr: new globalThis.TextDecoder().decode(output.stderr),
    success: output.success,
  };
}

async function withTemporaryDirectory<Success>(
  useDirectory: (directoryPath: string) => Promise<Success>,
): Promise<Success> {
  const directoryPath = await Deno.makeTempDir({
    prefix: "coolheaded-file-spec-test-",
  });

  try {
    return await useDirectory(directoryPath);
  } finally {
    await Deno.remove(directoryPath, { recursive: true });
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry: unknown): boolean => typeof entry === "string")
  );
}

function isPinJsonConfig(value: unknown): value is PinJsonConfig {
  if (!isRecord(value) || typeof value["version"] !== "string") {
    return false;
  }

  return (
    isOptionalString(value["binaryVersion"]) &&
    isOptionalString(value["cargoVendorHash"]) &&
    isOptionalString(value["npmVendorHash"]) &&
    isOptionalString(value["packageHash"]) &&
    isOptionalString(value["sourceHash"]) &&
    (value["platformPackageHashes"] === undefined || isStringRecord(value["platformPackageHashes"]))
  );
}

function pinJsonHasCanonicalOrder(contents: string): boolean {
  const pin: unknown = JSON.parse(contents);
  return isPinJsonConfig(pin) ? contents === serializePinJson(pin) : false;
}

async function invalidPinOrder(name: string): Promise<string | undefined> {
  const pinPath = join(PACKAGES_DIRECTORY_PATH, name, "pin.json");
  if (!(await fileExists(pinPath))) {
    return undefined;
  }

  const contents = await Deno.readTextFile(pinPath);
  return pinJsonHasCanonicalOrder(contents) ? undefined : `${name}/pin.json`;
}

describe("package structure", (): void => {
  it("denies repository writes outside temporary fixtures", async (): Promise<void> => {
    await assertRejects(
      (): Promise<void> => Deno.writeTextFile(join(REPOSITORY_ROOT_PATH, ".permissionProbe"), ""),
      Deno.errors.NotCapable,
    );
  });

  it("isolates fileSpec subprocesses from loader environment variables", async (): Promise<void> => {
    const environmentPath = await Deno.makeTempFile();
    try {
      await Deno.writeTextFile(
        environmentPath,
        "LD_DYLD_PATH=/tmp/coolheaded-file-spec-loader-path\n",
      );
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--no-check",
          `--env-file=${environmentPath}`,
          "--allow-env=PATH,COOLHEADED_CUE,COOLHEADED_GIT",
          "--allow-read",
          `--allow-run=${requiredToolPath("COOLHEADED_CUE")},${requiredToolPath("COOLHEADED_GIT")}`,
          "--allow-write",
          "lib/ts/repo/fileSpec.ts",
        ],
        clearEnv: true,
        cwd: REPOSITORY_ROOT_PATH,
        env: {
          COOLHEADED_CUE: requiredToolPath("COOLHEADED_CUE"),
          COOLHEADED_GIT: requiredToolPath("COOLHEADED_GIT"),
          PATH: Deno.env.get("PATH") ?? "",
        },
        stderr: "piped",
        stdout: "piped",
      });

      const output = await command.output();

      assertEquals(output.success, true, new globalThis.TextDecoder().decode(output.stderr).trim());
    } finally {
      await Deno.remove(environmentPath);
    }
  });

  it("rejects ignored directories hiding fileSpec-admitted files", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await runGit(repositoryRoot, ["init"]);
      await Deno.mkdir(join(repositoryRoot, "hidden"));
      await Deno.writeTextFile(join(repositoryRoot, ".gitignore"), "hidden/\n");
      await Deno.writeTextFile(
        join(repositoryRoot, "fileSpec.cue"),
        `package fileSpec

#RegularFile: true

#FileSpecPath: {
	".gitignore"?:   #RegularFile
	"fileSpec.cue"?: #RegularFile
	hidden?: {
		"allowed.ts"?: #RegularFile
	}
}

#FileSpec: {
\t".gitignore"!:   #RegularFile
\t"fileSpec.cue"!: #RegularFile
\thidden?: {
\t\t"allowed.ts"?: #RegularFile
\t}
}
`,
      );
      await Deno.writeTextFile(join(repositoryRoot, "hidden/allowed.ts"), "export {};\n");
      await runGit(repositoryRoot, ["add", ".gitignore", "fileSpec.cue"]);

      await assertRejects(
        (): Promise<void> => checkFileSpec(repositoryRoot),
        Error,
        "hidden/allowed.ts",
      );
    });
  });
});

describe("tree conformance boundaries", (): void => {
  it("rejects tracked paths hidden by ignore rules", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await runGit(repositoryRoot, ["init"]);
      await Deno.writeTextFile(join(repositoryRoot, ".gitignore"), "tracked.ts\n");
      await Deno.writeTextFile(
        join(repositoryRoot, "fileSpec.cue"),
        `package fileSpec

#RegularFile: true

#FileSpecPath: {
\t".gitignore"?:   #RegularFile
\t"fileSpec.cue"?: #RegularFile
\t"tracked.ts"?:   #RegularFile
}

#FileSpec: {
\t".gitignore"!:   #RegularFile
\t"fileSpec.cue"!: #RegularFile
\t"tracked.ts"!:   #RegularFile
}
`,
      );
      await Deno.writeTextFile(join(repositoryRoot, "tracked.ts"), "export {};\n");
      await runGit(repositoryRoot, ["add", ".gitignore", "fileSpec.cue"]);
      await runGit(repositoryRoot, ["add", "-f", "tracked.ts"]);

      await assertRejects((): Promise<void> => checkFileSpec(repositoryRoot), Error, "tracked.ts");
    });
  });

  it("rejects an extra visible file", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await runGit(repositoryRoot, ["init"]);
      await Deno.writeTextFile(join(repositoryRoot, ".gitignore"), "");
      await Deno.writeTextFile(
        join(repositoryRoot, "fileSpec.cue"),
        `package fileSpec

#RegularFile: true

#FileSpecPath: {
\t".gitignore"?:   #RegularFile
\t"fileSpec.cue"?: #RegularFile
}

#FileSpec: {
\t".gitignore"!:   #RegularFile
\t"fileSpec.cue"!: #RegularFile
}
`,
      );
      await Deno.writeTextFile(join(repositoryRoot, "extra.ts"), "export {};\n");
      await runGit(repositoryRoot, ["add", ".gitignore", "fileSpec.cue"]);

      await assertRejects((): Promise<void> => checkFileSpec(repositoryRoot), Error, "extra.ts");
    });
  });

  it("rejects a missing required file", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await runGit(repositoryRoot, ["init"]);
      await Deno.writeTextFile(join(repositoryRoot, ".gitignore"), "");
      await Deno.writeTextFile(
        join(repositoryRoot, "fileSpec.cue"),
        `package fileSpec

#RegularFile: true

#FileSpecPath: {
\t".gitignore"?:   #RegularFile
\t"fileSpec.cue"?: #RegularFile
\t"required.ts"?:  #RegularFile
}

#FileSpec: {
\t".gitignore"!:   #RegularFile
\t"fileSpec.cue"!: #RegularFile
\t"required.ts"!:  #RegularFile
}
`,
      );
      await runGit(repositoryRoot, ["add", ".gitignore", "fileSpec.cue"]);

      await assertRejects((): Promise<void> => checkFileSpec(repositoryRoot), Error, "required.ts");
    });
  });
});

describe("ignored path hardening", (): void => {
  it("rejects ignored sibling combinations admitted together", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await runGit(repositoryRoot, ["init"]);
      await Deno.mkdir(join(repositoryRoot, "hidden"));
      await Deno.writeTextFile(join(repositoryRoot, ".gitignore"), "hidden/\n");
      await Deno.writeTextFile(
        join(repositoryRoot, "fileSpec.cue"),
        `package fileSpec

#RegularFile: true

#FileSpecPath: {
	".gitignore"?:   #RegularFile
	"fileSpec.cue"?: #RegularFile
	hidden?: {
		"a.ts"?: #RegularFile
		"b.ts"?: #RegularFile
	}
}

#FileSpec: {
	".gitignore"!:   #RegularFile
	"fileSpec.cue"!: #RegularFile
	hidden?: {
		"a.ts"!: #RegularFile
		"b.ts"!: #RegularFile
	}
}
`,
      );
      await Deno.writeTextFile(join(repositoryRoot, "hidden/a.ts"), "export {};\n");
      await Deno.writeTextFile(join(repositoryRoot, "hidden/b.ts"), "export {};\n");
      await runGit(repositoryRoot, ["add", ".gitignore", "fileSpec.cue"]);

      await assertRejects((): Promise<void> => checkFileSpec(repositoryRoot), Error, "hidden/a.ts");
    });
  });

  it("fails closed when an ignored candidate CUE process fails", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await runGit(repositoryRoot, ["init"]);
      await Deno.mkdir(join(repositoryRoot, "hidden"));
      await Deno.writeTextFile(
        join(repositoryRoot, ".gitignore"),
        "hidden/\nfake-cue\ncue-call-count\n",
      );
      await Deno.writeTextFile(
        join(repositoryRoot, "fileSpec.cue"),
        `package fileSpec

#RegularFile: true

#FileSpecPath: {
	".gitignore"?:   #RegularFile
	"fileSpec.cue"?: #RegularFile
	hidden?: {
		"allowed.ts"?: #RegularFile
	}
}

#FileSpec: {
	".gitignore"!:   #RegularFile
	"fileSpec.cue"!: #RegularFile
}
`,
      );
      await Deno.writeTextFile(join(repositoryRoot, "hidden/allowed.ts"), "export {};\n");
      await runGit(repositoryRoot, ["add", ".gitignore", "fileSpec.cue"]);

      const fakeCuePath = join(repositoryRoot, "fake-cue");
      const cueCallCountPath = join(repositoryRoot, "cue-call-count");
      await Deno.writeTextFile(
        fakeCuePath,
        `#!/bin/sh
state=${JSON.stringify(cueCallCountPath)}
realCue=${JSON.stringify(requiredToolPath("COOLHEADED_CUE"))}
if [ "$1" = "vet" ]; then
  count=0
  if [ -f "$state" ]; then count=$(cat "$state"); fi
  count=$((count + 1))
  printf "%s" "$count" > "$state"
  if [ "$count" -ge 3 ]; then
    printf "synthetic cue runtime failure\\n" >&2
    exit 1
  fi
fi
exec "$realCue" "$@"
`,
      );
      await Deno.chmod(fakeCuePath, EXECUTABLE_MODE);

      const output = await runFileSpecChecker(repositoryRoot, fakeCuePath);

      assertEquals(output.success, false);
      assertEquals(output.stderr.includes("synthetic cue runtime failure"), true, output.stderr);
    });
  });
});

describe("Git index hardening", (): void => {
  it("rejects tracked symlinks while accepting executable blobs", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await runGit(repositoryRoot, ["init"]);
      await Deno.writeTextFile(join(repositoryRoot, ".gitignore"), "");
      await Deno.writeTextFile(
        join(repositoryRoot, "fileSpec.cue"),
        `package fileSpec

#RegularFile: true

#FileSpecPath: {
	".gitignore"?:   #RegularFile
	"fileSpec.cue"?: #RegularFile
	link?:            #RegularFile
	executable?:      #RegularFile
}

#FileSpec: {
	".gitignore"!:   #RegularFile
	"fileSpec.cue"!: #RegularFile
	link?:            #RegularFile
	executable?:      #RegularFile
}
`,
      );
      await Deno.writeTextFile(join(repositoryRoot, "executable"), "#!/bin/sh\n");
      await Deno.chmod(join(repositoryRoot, "executable"), EXECUTABLE_MODE);
      await runGit(repositoryRoot, ["add", ".gitignore", "fileSpec.cue", "executable"]);
      await checkFileSpec(repositoryRoot);

      const linkBlobOutput = await runGitWithInput(
        repositoryRoot,
        ["hash-object", "-w", "--stdin"],
        ".gitignore",
      );
      const linkBlob = linkBlobOutput.trim();
      await runGit(repositoryRoot, [
        "update-index",
        "--add",
        "--cacheinfo",
        `120000,${linkBlob},link`,
      ]);

      await assertRejects(
        (): Promise<void> => checkFileSpec(repositoryRoot),
        Error,
        "kind symlink",
      );
    });
  });

  it("rejects unresolved index stages", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await runGit(repositoryRoot, ["init"]);
      await Deno.writeTextFile(join(repositoryRoot, ".gitignore"), "");
      await Deno.writeTextFile(
        join(repositoryRoot, "fileSpec.cue"),
        `package fileSpec

#RegularFile: true

#FileSpecPath: {
	".gitignore"?:   #RegularFile
	"fileSpec.cue"?: #RegularFile
	conflict?:        #RegularFile
}

#FileSpec: {
	".gitignore"!:   #RegularFile
	"fileSpec.cue"!: #RegularFile
	conflict?:        #RegularFile
}
`,
      );
      await runGit(repositoryRoot, ["add", ".gitignore", "fileSpec.cue"]);
      const firstObjectOutput = await runGitWithInput(
        repositoryRoot,
        ["hash-object", "-w", "--stdin"],
        "first\n",
      );
      const firstObject = firstObjectOutput.trim();
      const secondObjectOutput = await runGitWithInput(
        repositoryRoot,
        ["hash-object", "-w", "--stdin"],
        "second\n",
      );
      const secondObject = secondObjectOutput.trim();
      await runGitWithInput(
        repositoryRoot,
        ["update-index", "--index-info"],
        `100644 ${firstObject} 1\tconflict\n100644 ${secondObject} 2\tconflict\n`,
      );

      await assertRejects(
        (): Promise<void> => checkFileSpec(repositoryRoot),
        Error,
        "unresolved stage",
      );
    });
  });
});

describe("snapshot hardening", (): void => {
  it("rejects a repository that changes during validation", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await runGit(repositoryRoot, ["init"]);
      await Deno.mkdir(join(repositoryRoot, "hidden"));
      await Deno.writeTextFile(
        join(repositoryRoot, ".gitignore"),
        "hidden/\nfake-cue\nsnapshot-state\n",
      );
      await Deno.writeTextFile(
        join(repositoryRoot, "fileSpec.cue"),
        `package fileSpec

#RegularFile: true

#FileSpecPath: {
	".gitignore"?:   #RegularFile
	"fileSpec.cue"?: #RegularFile
}

#FileSpec: {
	".gitignore"!:   #RegularFile
	"fileSpec.cue"!: #RegularFile
}
`,
      );
      await Deno.writeTextFile(join(repositoryRoot, "hidden/allowed.ts"), "export {};\n");
      await runGit(repositoryRoot, ["add", ".gitignore", "fileSpec.cue"]);

      const fakeCuePath = join(repositoryRoot, "fake-cue");
      const snapshotStatePath = join(repositoryRoot, "snapshot-state");
      await Deno.writeTextFile(
        fakeCuePath,
        `#!/bin/sh
realCue=${JSON.stringify(requiredToolPath("COOLHEADED_CUE"))}
state=${JSON.stringify(snapshotStatePath)}
if [ "$1" = "vet" ] && [ ! -f "$state" ]; then
  printf "\\n" >> "$2"
  printf "changed" > "$state"
fi
exec "$realCue" "$@"
`,
      );
      await Deno.chmod(fakeCuePath, EXECUTABLE_MODE);

      const output = await runFileSpecChecker(repositoryRoot, fakeCuePath);

      assertEquals(output.success, false);
      assertEquals(output.stderr.includes("repository changed"), true, output.stderr);
    });
  });
});

describe("path and concurrency hardening", (): void => {
  it("rejects non-NFC and case-fold-colliding Git paths", async (): Promise<void> => {
    await assertRejects(
      async (): Promise<void> => {
        await Promise.resolve();
        validateGitPathNames(["e\u0301.ts"]);
      },
      Error,
      "not NFC-normalized",
    );
    await assertRejects(
      async (): Promise<void> => {
        await Promise.resolve();
        validateGitPathNames(["A.ts", "a.ts"]);
      },
      Error,
      "case-fold collision",
    );
  });

  it("caps concurrent fileSpec subprocess work", async (): Promise<void> => {
    let active = 0;
    let maximum = 0;
    const results = await mapWithConcurrency(
      Array.from(
        { length: CONCURRENCY_TEST_ITEM_COUNT },
        (_value: undefined, index: number): number => index,
      ),
      MAX_CONCURRENT_FILE_SPEC_PROCESSES,
      async (value: number): Promise<number> => {
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active -= 1;
        return value;
      },
    );

    assertEquals(maximum, 8);
    assertEquals(
      results,
      Array.from(
        { length: CONCURRENCY_TEST_ITEM_COUNT },
        (_value: undefined, index: number): number => index,
      ),
    );
  });
});

describe("pin metadata", (): void => {
  it("keeps pin.json fields in canonical order", async (): Promise<void> => {
    const directoryNames = await packageDirectories();
    const invalidPins = await Promise.all(
      directoryNames.map((name: string): Promise<string | undefined> => invalidPinOrder(name)),
    );

    assertEquals(
      invalidPins.filter((pin): pin is string => pin !== undefined),
      [],
    );
  });
});
