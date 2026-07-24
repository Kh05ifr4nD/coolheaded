import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from "coolheaded/core/commandRunner.ts";

class CommandStartError extends Error {
  public readonly request: CommandRequest;

  public constructor(request: CommandRequest, cause: unknown) {
    super(`Failed to start command: ${request.command.join(" ")}`, { cause });
    this.name = "CommandStartError";
    this.request = request;
  }
}

async function runDenoCommand(request: CommandRequest): Promise<CommandResult> {
  const [executable, ...args] = request.command;
  try {
    const output = await new Deno.Command(executable, {
      args,
      stderr: "piped",
      stdin: "null",
      stdout: "piped",
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      ...(request.env === undefined ? {} : { env: request.env }),
    }).output();

    return {
      code: output.code,
      stderr: new globalThis.TextDecoder().decode(output.stderr),
      stdout: new globalThis.TextDecoder().decode(output.stdout),
    };
  } catch (error: unknown) {
    throw new CommandStartError(request, error);
  }
}

const denoCommandRunner = {
  run: runDenoCommand,
} satisfies CommandRunner;

export { CommandStartError, denoCommandRunner };
