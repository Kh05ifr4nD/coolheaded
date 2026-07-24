import { REPOSITORY_ROOT_PATH, requiredToolPath } from "./fixture.ts";
import type { RepositorySnapshot, ToolIdentity } from "coolheaded/repo/fileSpec/model.ts";
import { dirname } from "@jsr/std__path";

type ToolEnvironment = Readonly<{
  readonly cue: string;
  readonly git: string;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseToolIdentity(value: unknown): ToolIdentity {
  if (
    !isRecord(value) ||
    typeof value["executable"] !== "string" ||
    typeof value["sha256"] !== "string" ||
    typeof value["version"] !== "string"
  ) {
    throw new Error("invalid tool identity");
  }

  return {
    executable: value["executable"],
    sha256: value["sha256"],
    version: value["version"],
  };
}

function parseRepositorySnapshot(value: unknown): RepositorySnapshot {
  if (
    !isRecord(value) ||
    typeof value["enumerationSha256"] !== "string" ||
    typeof value["fileSpecSha256"] !== "string" ||
    typeof value["head"] !== "string" ||
    typeof value["ignoreSourcesSha256"] !== "string" ||
    typeof value["indexTree"] !== "string" ||
    !isRecord(value["tools"])
  ) {
    throw new Error("invalid repository snapshot");
  }

  return {
    enumerationSha256: value["enumerationSha256"],
    fileSpecSha256: value["fileSpecSha256"],
    head: value["head"],
    ignoreSourcesSha256: value["ignoreSourcesSha256"],
    indexTree: value["indexTree"],
    tools: {
      cue: parseToolIdentity(value["tools"]["cue"]),
      deno: parseToolIdentity(value["tools"]["deno"]),
      git: parseToolIdentity(value["tools"]["git"]),
    },
  };
}

async function runSnapshotProbe(
  repositoryRoot: string,
  tools: ToolEnvironment,
): Promise<RepositorySnapshot> {
  const probePath = await Deno.makeTempFile({ prefix: "coolheaded-snapshot-probe-" });
  try {
    const repositoryAccessPath = await Deno.realPath(repositoryRoot);
    const temporaryRoot = dirname(probePath);
    const temporaryAccessRoot = dirname(await Deno.realPath(probePath));
    const gitModule = new globalThis.URL(
      "lib/ts/repo/fileSpec/git.ts",
      new globalThis.URL(`file://${REPOSITORY_ROOT_PATH}/`),
    ).href;
    await Deno.writeTextFile(
      probePath,
      `import { repositorySnapshot } from ${JSON.stringify(gitModule)};
const snapshot = await repositorySnapshot(Deno.args[0] ?? "", {
  ignoredPaths: [],
  indexPaths: [".gitignore", "fileSpec.cue"],
  visiblePaths: [],
});
console.log(JSON.stringify(snapshot));
`,
    );
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-check",
        `--config=${REPOSITORY_ROOT_PATH}/deno.jsonc`,
        "--allow-env=PATH,COOLHEADED_CUE,COOLHEADED_GIT",
        `--allow-read=${repositoryRoot},${repositoryAccessPath},${temporaryRoot},${temporaryAccessRoot},${tools.cue},${tools.git},${Deno.execPath()}`,
        `--allow-run=${tools.cue},${tools.git}`,
        probePath,
        repositoryRoot,
      ],
      clearEnv: true,
      cwd: repositoryRoot,
      env: {
        COOLHEADED_CUE: tools.cue,
        COOLHEADED_GIT: tools.git,
        PATH: Deno.env.get("PATH") ?? "",
      },
      stderr: "piped",
      stdout: "piped",
    }).output();
    if (!output.success) {
      throw new Error(new globalThis.TextDecoder().decode(output.stderr).trim());
    }
    return parseRepositorySnapshot(JSON.parse(new globalThis.TextDecoder().decode(output.stdout)));
  } finally {
    await Deno.remove(probePath);
  }
}

function actualToolEnvironment(): ToolEnvironment {
  return {
    cue: requiredToolPath("COOLHEADED_CUE"),
    git: requiredToolPath("COOLHEADED_GIT"),
  };
}

export { actualToolEnvironment, runSnapshotProbe };
export type { ToolEnvironment };
