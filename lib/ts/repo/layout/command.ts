import type { LayoutCommand, ToolIdentity } from "coolheaded/repo/layout/types.ts";
import {
  inputDecodeError,
  internalInvariantError,
  isLayoutError,
  toolExecutionError,
} from "coolheaded/repo/layout/model.ts";

type CommandEnvironment = Readonly<{
  clearEnv?: boolean;
  env?: Readonly<Record<string, string>>;
}>;

const LAYOUT_COMMANDS = {
  cue: { environmentVariable: "COOLHEADED_CUE", versionArguments: ["version"] },
  git: { environmentVariable: "COOLHEADED_GIT", versionArguments: ["--version"] },
} as const satisfies Readonly<
  Record<
    LayoutCommand,
    Readonly<{ environmentVariable: string; versionArguments: readonly string[] }>
  >
>;

function resolveToolExecutable(command: LayoutCommand): string {
  const { environmentVariable } = LAYOUT_COMMANDS[command];
  const executable = Deno.env.get(environmentVariable);

  if (typeof executable !== "string" || executable.length === 0) {
    throw internalInvariantError(
      `${environmentVariable} must contain an absolute ${command} executable path`,
    );
  }

  if (!executable.startsWith("/")) {
    throw internalInvariantError(
      `${environmentVariable} must contain an absolute ${command} executable path: ${executable}`,
    );
  }

  return executable;
}

function isolatedCommandEnvironment(): CommandEnvironment {
  return {
    clearEnv: true,
    env: { PATH: Deno.env.get("PATH") ?? "" },
  };
}

async function executeCommand(
  command: LayoutCommand,
  args: readonly string[],
  cwd: string | undefined,
): Promise<Readonly<{ executable: string; output: Deno.CommandOutput }>> {
  const executable = resolveToolExecutable(command);

  try {
    const process = new Deno.Command(executable, {
      args: [...args],
      ...isolatedCommandEnvironment(),
      ...(typeof cwd === "string" ? { cwd } : {}),
      stderr: "piped",
      stdin: "null",
      stdout: "piped",
    }).spawn();

    return { executable, output: await process.output() };
  } catch (error: unknown) {
    if (isLayoutError(error)) {
      throw error;
    }

    const detail = error instanceof Error ? error.message : String(error);
    throw toolExecutionError(command, executable, args, undefined, detail);
  }
}

function decodeUtf8(bytes: readonly number[], source: string): string {
  try {
    const view = Uint8Array.from(bytes);
    return new globalThis.TextDecoder("utf8", { fatal: true }).decode(view);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw inputDecodeError(source, detail);
  }
}

async function commandOutput(
  command: LayoutCommand,
  args: readonly string[],
  cwd?: string,
  successCodes: readonly number[] = [0],
): Promise<string> {
  const { executable, output } = await executeCommand(command, args, cwd);

  if (successCodes.includes(output.code)) {
    return decodeUtf8([...output.stdout], `${command} stdout`);
  }

  const stderr = decodeUtf8([...output.stderr], `${command} stderr`).trim();
  throw toolExecutionError(command, executable, args, output.code, stderr);
}

async function digestBytes(bytes: readonly number[]): Promise<string> {
  const view = Uint8Array.from(bytes);
  const input = new ArrayBuffer(view.byteLength);
  new Uint8Array(input).set(view);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte: number): string =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function digestFile(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  return digestBytes([...bytes]);
}

async function digestText(text: string): Promise<string> {
  return await digestBytes([...new globalThis.TextEncoder().encode(text)]);
}

async function toolExecutableBytes(
  command: LayoutCommand,
  executable: string,
): Promise<Uint8Array> {
  try {
    return await Deno.readFile(executable);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw toolExecutionError(command, executable, [], undefined, detail);
  }
}

async function toolIdentity(command: LayoutCommand): Promise<ToolIdentity> {
  const executable = resolveToolExecutable(command);
  const version = await commandOutput(command, LAYOUT_COMMANDS[command].versionArguments);
  const executableBytes = await toolExecutableBytes(command, executable);

  return {
    executable,
    sha256: await digestBytes([...executableBytes]),
    version: version.trim(),
  };
}

async function denoToolIdentity(): Promise<ToolIdentity> {
  const executable = Deno.execPath();
  const executableBytes = await Deno.readFile(executable);

  return {
    executable,
    sha256: await digestBytes([...executableBytes]),
    version: Deno.version.deno,
  };
}

export { commandOutput, denoToolIdentity, digestFile, digestText, toolIdentity };
