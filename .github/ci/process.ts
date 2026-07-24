#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run --allow-write

import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from "coolheaded/core/commandRunner.ts";

interface RunOptions {
  readonly capture?: boolean;
  readonly check?: boolean;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

interface RunResult {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}

class CommandExitError extends Error {
  public readonly request: CommandRequest;
  public readonly result: CommandResult;

  public constructor(request: CommandRequest, result: CommandResult) {
    super(
      `${request.command.join(" ")} failed with exit ${result.code}${
        result.stderr.trim().length === 0 ? "" : `: ${result.stderr.trim()}`
      }`,
    );
    this.name = "CommandExitError";
    this.request = request;
    this.result = result;
  }
}

async function writeStdout(text: string): Promise<void> {
  await Deno.stdout.write(new globalThis.TextEncoder().encode(`${text}\n`));
}

async function writeStderr(text: string): Promise<void> {
  await Deno.stderr.write(new globalThis.TextEncoder().encode(`${text}\n`));
}

async function run(
  runner: CommandRunner,
  command: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const [executable, ...args] = command;
  if (executable === undefined) {
    throw new Error("Missing command executable");
  }

  const request = {
    command: [executable, ...args],
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
  } as const satisfies CommandRequest;
  const output = await runner.run(request);
  const result = {
    code: output.code,
    stderr: output.stderr.trim(),
    stdout: output.stdout.trim(),
  };

  if ((options.check ?? true) && output.code !== 0) {
    throw new CommandExitError(request, output);
  }

  if (!(options.capture ?? true)) {
    if (result.stdout.length > 0) {
      await writeStdout(result.stdout);
    }
    if (result.stderr.length > 0) {
      await writeStderr(result.stderr);
    }
  }

  return result;
}

async function gitHasChanges(
  runner: CommandRunner,
  paths: readonly string[] = [],
): Promise<boolean> {
  const result = await run(runner, ["git", "diff", "--quiet", ...paths], {
    check: false,
  });
  return result.code !== 0;
}

async function changedFiles(runner: CommandRunner): Promise<readonly string[]> {
  const result = await run(runner, ["git", "diff", "--name-only"], { capture: true });
  return result.stdout.split("\n").filter((line: string): boolean => line.length > 0);
}

async function writeOutput(key: string, value: string): Promise<void> {
  const outputPath = Deno.env.get("GITHUB_OUTPUT");
  if (outputPath === undefined) {
    await writeStdout(`output: ${key}=${value}`);
    return;
  }

  const delimiter = `coolheaded_${key}_${globalThis.crypto.randomUUID()}`;
  await Deno.writeTextFile(
    outputPath,
    value.includes("\n") ? `${key}<<${delimiter}\n${value}\n${delimiter}\n` : `${key}=${value}\n`,
    { append: true },
  );
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(path));
}

async function nixEvalRaw(runner: CommandRunner, expr: string): Promise<string> {
  const result = await run(runner, ["nix", "eval", "--raw", expr], { capture: true });
  return result.stdout;
}

async function currentSystem(runner: CommandRunner): Promise<string> {
  const result = await run(
    runner,
    ["nix", "eval", "--impure", "--raw", "--expr", "builtins.currentSystem"],
    { capture: true },
  );
  return result.stdout;
}

function assertOnlyChangedFiles(
  files: readonly string[],
  allowed: (file: string) => boolean,
): void {
  const unexpectedFiles = files.filter((file: string): boolean => !allowed(file));
  if (unexpectedFiles.length > 0) {
    throw new Error(`Unexpected changed files: ${unexpectedFiles.join(", ")}`);
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export {
  CommandExitError,
  assertOnlyChangedFiles,
  changedFiles,
  currentSystem,
  gitHasChanges,
  isRecord,
  nixEvalRaw,
  readJson,
  run,
  writeOutput,
  writeStderr,
  writeStdout,
};
export type { RunResult };
