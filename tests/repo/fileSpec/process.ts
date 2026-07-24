import {
  EXECUTABLE_MODE,
  REPOSITORY_ROOT_PATH,
  requiredToolPath,
  withTemporaryDirectory,
  writeRepositoryFixture,
} from "./fixture.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import type { FileSpecCommand } from "coolheaded/repo/fileSpec/model.ts";
import { commandOutput } from "coolheaded/repo/fileSpec/git.ts";

type ToolCase = Readonly<{
  readonly command: FileSpecCommand;
  readonly environmentVariable: "COOLHEADED_CUE" | "COOLHEADED_GIT";
  readonly versionArguments: readonly string[];
}>;

const TOOL_CASES = [
  {
    command: "cue",
    environmentVariable: "COOLHEADED_CUE",
    versionArguments: ["version"],
  },
  {
    command: "git",
    environmentVariable: "COOLHEADED_GIT",
    versionArguments: ["--version"],
  },
] as const satisfies readonly ToolCase[];
const PROBE_ERROR_EXIT_CODE = 19;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function toolError(tool: ToolCase, executable?: string): Promise<Error> {
  const original = requiredToolPath(tool.environmentVariable);
  try {
    if (executable === undefined) {
      Deno.env.delete(tool.environmentVariable);
    } else {
      Deno.env.set(tool.environmentVariable, executable);
    }
    const error = await assertRejects(
      (): Promise<string> => commandOutput(tool.command, tool.versionArguments),
    );
    assertInstanceOf(error, Error);
    return error;
  } finally {
    Deno.env.set(tool.environmentVariable, original);
  }
}

async function nonexistentToolError(
  tool: ToolCase,
  executable: string,
): Promise<Readonly<Record<string, unknown>>> {
  const probePath = await Deno.makeTempFile({ prefix: "coolheaded-tool-probe-" });
  try {
    const gitModule = new globalThis.URL(
      "lib/ts/repo/fileSpec/git.ts",
      new globalThis.URL(`file://${REPOSITORY_ROOT_PATH}/`),
    ).href;
    await Deno.writeTextFile(
      probePath,
      `import { commandOutput } from ${JSON.stringify(gitModule)};
try {
  await commandOutput(${JSON.stringify(tool.command)}, ${JSON.stringify(tool.versionArguments)});
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
        `--allow-read=${REPOSITORY_ROOT_PATH},${probePath}`,
        `--allow-run=${executable}`,
        probePath,
      ],
      clearEnv: true,
      cwd: REPOSITORY_ROOT_PATH,
      env: {
        COOLHEADED_CUE: tool.command === "cue" ? executable : requiredToolPath("COOLHEADED_CUE"),
        COOLHEADED_GIT: tool.command === "git" ? executable : requiredToolPath("COOLHEADED_GIT"),
        PATH: Deno.env.get("PATH") ?? "",
      },
      stderr: "piped",
      stdout: "piped",
    }).output();
    if (output.code !== PROBE_ERROR_EXIT_CODE) {
      throw new Error(new globalThis.TextDecoder().decode(output.stderr).trim());
    }
    const value: unknown = JSON.parse(new globalThis.TextDecoder().decode(output.stdout));
    if (!isRecord(value)) {
      throw new Error("tool probe did not emit a structured error");
    }
    return value;
  } finally {
    await Deno.remove(probePath);
  }
}

describe("FileSpec tool process boundaries", (): void => {
  it("isolates subprocesses from loader environment variables", async (): Promise<void> => {
    await withTemporaryDirectory(async (directoryPath: string): Promise<void> => {
      await writeRepositoryFixture(directoryPath, { gitignore: "environment\n" });
      const environmentPath = `${directoryPath}/environment`;
      await Deno.writeTextFile(environmentPath, "LD_DYLD_PATH=/tmp/loader-path\n");
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--no-check",
          `--env-file=${environmentPath}`,
          "--allow-env=PATH,COOLHEADED_CUE,COOLHEADED_GIT",
          "--allow-read",
          `--allow-run=${requiredToolPath("COOLHEADED_CUE")},${requiredToolPath("COOLHEADED_GIT")}`,
          "--allow-write",
          `${REPOSITORY_ROOT_PATH}/lib/ts/repo/fileSpec.ts`,
        ],
        clearEnv: true,
        cwd: directoryPath,
        env: {
          COOLHEADED_CUE: requiredToolPath("COOLHEADED_CUE"),
          COOLHEADED_GIT: requiredToolPath("COOLHEADED_GIT"),
          PATH: Deno.env.get("PATH") ?? "",
        },
        stderr: "piped",
      }).output();

      assertEquals(output.success, true, new globalThis.TextDecoder().decode(output.stderr).trim());
    });
  });

  it("uses absolute configured Git and CUE executables", async (): Promise<void> => {
    const gitVersion = await commandOutput("git", ["--version"]);
    const cueVersion = await commandOutput("cue", ["version"]);
    assertEquals(gitVersion.length > 0, true);
    assertEquals(cueVersion.length > 0, true);
  });

  it("classifies missing, relative, and nonexistent configured tools", async (): Promise<void> => {
    await withTemporaryDirectory(async (directoryPath: string): Promise<void> => {
      const markerPath = `${directoryPath}/called`;
      await Promise.all(
        TOOL_CASES.map(async (tool: ToolCase): Promise<void> => {
          await Deno.writeTextFile(
            `${directoryPath}/${tool.command}`,
            `#!/bin/sh\ntouch ${JSON.stringify(markerPath)}\nexit 31\n`,
          );
          await Deno.chmod(`${directoryPath}/${tool.command}`, EXECUTABLE_MODE);
        }),
      );
      const originalPath = Deno.env.get("PATH") ?? "";
      try {
        Deno.env.set("PATH", `${directoryPath}:${originalPath}`);
        await Promise.all(
          TOOL_CASES.map(async (tool: ToolCase): Promise<void> => {
            const missingError = await toolError(tool);
            assertEquals(
              "kind" in missingError ? missingError.kind : undefined,
              "internalInvariant",
            );
            const relativeError = await toolError(tool, tool.command);
            assertEquals(
              "kind" in relativeError ? relativeError.kind : undefined,
              "internalInvariant",
            );
            const executable = `${directoryPath}/missing-${tool.command}`;
            const error = await nonexistentToolError(tool, executable);
            assertEquals(error["kind"], "toolExecution");
            assertEquals(error["command"], tool.command);
            assertEquals(error["executable"], executable);
            assertEquals(error["args"], tool.versionArguments);
            assertEquals(typeof error["exitCode"], "undefined");
            assertEquals(typeof error["stderr"], "string");
            assertEquals(String(error["stderr"]).includes("os error 2"), true);
            assertEquals(String(error["stderr"]).includes("NotCapable"), false);
          }),
        );
        await assertRejects(
          (): Promise<Deno.FileInfo> => Deno.stat(markerPath),
          Deno.errors.NotFound,
        );
      } finally {
        Deno.env.set("PATH", originalPath);
      }
    });
  });
});
