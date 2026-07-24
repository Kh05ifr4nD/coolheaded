import { dirname, join } from "@jsr/std__path";

const EXECUTABLE_MODE = 0o755;
const PROBE_ERROR_EXIT_CODE = 19;
const REPOSITORY_ROOT_PATH = new globalThis.URL("../../../", import.meta.url).pathname;
type FixtureFile = Readonly<{
  readonly contents: string;
  readonly path: string;
}>;

type RepositoryFixture = Readonly<{
  readonly files?: readonly FixtureFile[];
  readonly gitignore?: string;
  readonly pathFields?: string;
  readonly requiredFields?: string;
}>;

type FileSpecCheckerOutput = Readonly<{
  readonly stderr: string;
  readonly success: boolean;
}>;

type FileSpecProbeResult = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredToolPath(environmentVariable: string): string {
  const value = Deno.env.get(environmentVariable);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${environmentVariable} is not set; run tests in nix develop`);
  }

  return value;
}

async function runGit(
  repositoryRoot: string,
  args: readonly string[],
  input?: string,
): Promise<string> {
  const process = new Deno.Command(requiredToolPath("COOLHEADED_GIT"), {
    args: [...args],
    clearEnv: true,
    cwd: repositoryRoot,
    env: { PATH: Deno.env.get("PATH") ?? "" },
    stderr: "piped",
    stdin: input === undefined ? "null" : "piped",
    stdout: "piped",
  }).spawn();
  if (input !== undefined) {
    const writer = process.stdin.getWriter();
    await writer.write(new globalThis.TextEncoder().encode(input));
    await writer.close();
  }
  const output = await process.output();
  const stderr = new globalThis.TextDecoder().decode(output.stderr).trim();
  if (!output.success) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }

  return new globalThis.TextDecoder().decode(output.stdout);
}

async function runGitBytes(
  repositoryRoot: string,
  args: readonly string[],
  input: readonly number[],
): Promise<void> {
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
  await writer.write(Uint8Array.from(input));
  await writer.close();
  const output = await process.output();
  if (!output.success) {
    throw new Error(new globalThis.TextDecoder().decode(output.stderr).trim());
  }
}

async function writeRepositoryFixture(
  repositoryRoot: string,
  fixture: RepositoryFixture = {},
): Promise<void> {
  const pathFields = fixture.pathFields ?? "";
  const requiredFields = fixture.requiredFields ?? "";
  await runGit(repositoryRoot, ["init"]);
  await Deno.writeTextFile(join(repositoryRoot, ".gitignore"), fixture.gitignore ?? "");
  await Deno.writeTextFile(
    join(repositoryRoot, "fileSpec.cue"),
    `package fileSpec

#RegularFile: true

#FileSpecPath: {
	".gitignore"?:   #RegularFile
	"fileSpec.cue"?: #RegularFile
${pathFields}
}

#FileSpec: {
	".gitignore"!:   #RegularFile
	"fileSpec.cue"!: #RegularFile
${requiredFields}
}
`,
  );
  await Promise.all(
    (fixture.files ?? []).map(async (file: FixtureFile): Promise<void> => {
      const path = join(repositoryRoot, file.path);
      const parent = join(path, "..");
      await Deno.mkdir(parent, { recursive: true });
      await Deno.writeTextFile(path, file.contents);
    }),
  );
  await runGit(repositoryRoot, ["add", ".gitignore", "fileSpec.cue"]);
}

async function runFileSpecChecker(
  repositoryRoot: string,
  cuePath: string,
): Promise<FileSpecCheckerOutput> {
  const gitPath = requiredToolPath("COOLHEADED_GIT");
  const repositoryAccessPath = await Deno.realPath(repositoryRoot);
  const temporaryRoot = dirname(repositoryRoot);
  const temporaryAccessRoot = dirname(repositoryAccessPath);
  const output = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--no-check",
      "--allow-env=PATH,COOLHEADED_CUE,COOLHEADED_GIT",
      `--allow-read=${repositoryRoot},${repositoryAccessPath},${temporaryRoot},${temporaryAccessRoot},${cuePath},${gitPath},${Deno.execPath()}`,
      `--allow-run=${cuePath},${gitPath}`,
      `--allow-write=${temporaryRoot},${temporaryAccessRoot}`,
      join(REPOSITORY_ROOT_PATH, "lib/ts/repo/fileSpec.ts"),
    ],
    clearEnv: true,
    cwd: repositoryRoot,
    env: {
      COOLHEADED_CUE: cuePath,
      COOLHEADED_GIT: gitPath,
      PATH: Deno.env.get("PATH") ?? "",
      TMPDIR: temporaryRoot,
    },
    stderr: "piped",
    stdout: "piped",
  }).output();

  return {
    stderr: new globalThis.TextDecoder().decode(output.stderr),
    success: output.success,
  };
}

async function runFileSpecErrorProbe(
  repositoryRoot: string,
  cuePath: string,
): Promise<FileSpecProbeResult> {
  const probePath = await Deno.makeTempFile({ prefix: "coolheaded-file-spec-probe-" });
  try {
    const gitPath = requiredToolPath("COOLHEADED_GIT");
    const repositoryAccessPath = await Deno.realPath(repositoryRoot);
    const temporaryRoot = dirname(probePath);
    const temporaryAccessRoot = dirname(await Deno.realPath(probePath));
    const checkModule = new globalThis.URL(
      "lib/ts/repo/fileSpec/check.ts",
      new globalThis.URL(`file://${REPOSITORY_ROOT_PATH}/`),
    ).href;
    await Deno.writeTextFile(
      probePath,
      `import { checkFileSpec } from ${JSON.stringify(checkModule)};
try {
  await checkFileSpec(Deno.args[0] ?? "");
  Deno.exit(0);
} catch (error: unknown) {
  if (error instanceof Error) {
    console.log(JSON.stringify({ ...error, message: error.message, name: error.name }));
    Deno.exit(19);
  }
  throw error;
}
`,
    );
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-check",
        `--config=${REPOSITORY_ROOT_PATH}/deno.jsonc`,
        "--allow-env=PATH,COOLHEADED_CUE,COOLHEADED_GIT",
        `--allow-read=${repositoryRoot},${repositoryAccessPath},${temporaryRoot},${temporaryAccessRoot},${cuePath},${gitPath},${Deno.execPath()}`,
        `--allow-run=${cuePath},${gitPath}`,
        `--allow-write=${temporaryRoot},${temporaryAccessRoot}`,
        probePath,
        repositoryRoot,
      ],
      clearEnv: true,
      cwd: repositoryRoot,
      env: {
        COOLHEADED_CUE: cuePath,
        COOLHEADED_GIT: gitPath,
        PATH: Deno.env.get("PATH") ?? "",
        TMPDIR: temporaryRoot,
      },
      stderr: "piped",
      stdout: "piped",
    }).output();
    if (output.code !== PROBE_ERROR_EXIT_CODE) {
      throw new Error(new globalThis.TextDecoder().decode(output.stderr).trim());
    }
    const value: unknown = JSON.parse(new globalThis.TextDecoder().decode(output.stdout));
    if (!isRecord(value)) {
      throw new Error("fileSpec probe did not emit a structured error");
    }
    return value;
  } finally {
    await Deno.remove(probePath);
  }
}

async function withTemporaryDirectory<Success>(
  useDirectory: (directoryPath: string) => Promise<Success>,
): Promise<Success> {
  const directoryPath = await Deno.makeTempDir({ prefix: "coolheaded-file-spec-test-" });
  try {
    return await useDirectory(directoryPath);
  } finally {
    await Deno.remove(directoryPath, { recursive: true });
  }
}

export {
  EXECUTABLE_MODE,
  REPOSITORY_ROOT_PATH,
  requiredToolPath,
  runFileSpecErrorProbe,
  runFileSpecChecker,
  runGit,
  runGitBytes,
  withTemporaryDirectory,
  writeRepositoryFixture,
};
export type { RepositoryFixture };
