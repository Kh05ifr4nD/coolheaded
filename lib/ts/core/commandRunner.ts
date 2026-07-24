type Command = readonly [executable: string, ...args: string[]];

type CommandRequest = Readonly<{
  readonly command: Command;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}>;

type CommandResult = Readonly<{
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}>;

interface CommandRunner {
  readonly run: (request: CommandRequest) => Promise<CommandResult>;
}

export type { Command, CommandRequest, CommandResult, CommandRunner };
