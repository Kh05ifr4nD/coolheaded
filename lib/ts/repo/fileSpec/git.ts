import { fileSpecError } from "coolheaded/repo/fileSpec/model.ts";

type CommandEnvironment = Readonly<{
  clearEnv?: boolean;
  env?: Readonly<Record<string, string>>;
}>;

function isolatedCommandEnvironment(): CommandEnvironment {
  return {
    clearEnv: true,
    env: { PATH: Deno.env.get("PATH") ?? "" },
  };
}

async function commandOutputWithInput(
  command: string,
  args: readonly string[],
  input: string,
  cwd: string,
  successCodes: readonly number[] = [0],
): Promise<string> {
  const process = new Deno.Command(command, {
    args: [...args],
    ...isolatedCommandEnvironment(),
    cwd,
    stderr: "piped",
    stdin: "piped",
    stdout: "piped",
  }).spawn();

  const writer = process.stdin.getWriter();
  await writer.write(new globalThis.TextEncoder().encode(input));
  await writer.close();

  const output = await process.output();

  if (successCodes.includes(output.code)) {
    return new globalThis.TextDecoder().decode(output.stdout);
  }

  const stderr = new globalThis.TextDecoder().decode(output.stderr).trim();
  const detail = stderr.length === 0 ? "" : `: ${stderr}`;
  throw fileSpecError(`Failed to run ${command}: exit ${output.code}${detail}`);
}

async function commandOutput(
  command: string,
  args: readonly string[],
  cwd?: string,
): Promise<string> {
  const process = new Deno.Command(command, {
    args: [...args],
    ...isolatedCommandEnvironment(),
    ...(typeof cwd === "string" ? { cwd } : {}),
    stderr: "piped",
    stdout: "piped",
  });
  const output = await process.output();

  if (output.success) {
    return new globalThis.TextDecoder().decode(output.stdout);
  }

  const stderr = new globalThis.TextDecoder().decode(output.stderr).trim();
  const detail = stderr.length === 0 ? "" : `: ${stderr}`;
  throw fileSpecError(`Failed to run ${command}: exit ${output.code}${detail}`);
}

function gitPaths(output: string): readonly string[] {
  return output
    .split("\0")
    .filter((path: string): boolean => path.length > 0)
    .toSorted();
}

function ignoredByPositivePattern(pattern: string): boolean {
  return pattern.length > 0 && !pattern.startsWith("!");
}

async function repositoryRoot(): Promise<string> {
  const output = await commandOutput("git", ["rev-parse", "--show-toplevel"]);
  return output.trim();
}

async function gitPathsFrom(
  repositoryRootPath: string,
  args: readonly string[],
): Promise<readonly string[]> {
  const output = await commandOutput(
    "git",
    ["ls-files", "--full-name", "-z", ...args],
    repositoryRootPath,
  );

  return gitPaths(output);
}

async function ignoredIndexPathDetails(
  repositoryRootPath: string,
  paths: readonly string[],
): Promise<readonly string[]> {
  if (paths.length === 0) {
    return [];
  }

  const output = await commandOutputWithInput(
    "git",
    ["check-ignore", "--stdin", "-z", "-v", "--no-index", "--non-matching"],
    paths.map((path: string): string => `${path}\0`).join(""),
    repositoryRootPath,
    [0, 1],
  );
  const fields = output.split("\0");
  const ignoredPaths: string[] = [];

  for (let index = 0; index + 3 < fields.length; index += 4) {
    const [source, line, pattern, path] = fields.slice(index, index + 4);

    if (
      typeof source === "string" &&
      typeof line === "string" &&
      typeof pattern === "string" &&
      typeof path === "string" &&
      ignoredByPositivePattern(pattern)
    ) {
      ignoredPaths.push(`${path} (${source}:${line}: ${pattern})`);
    }
  }

  return ignoredPaths;
}

async function expandIgnoredPath(
  repositoryRootPath: string,
  ignoredPath: string,
): Promise<readonly string[]> {
  if (!ignoredPath.endsWith("/")) {
    return [ignoredPath];
  }

  const paths = await gitPathsFrom(repositoryRootPath, [
    "--others",
    "--ignored",
    "--exclude-standard",
    "--",
    ignoredPath,
  ]);

  return paths.filter((path: string): boolean => !path.endsWith("/"));
}

async function ignoredFilePaths(repositoryRootPath: string): Promise<readonly string[]> {
  const ignoredPaths = await gitPathsFrom(repositoryRootPath, [
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
  ]);
  const expandedPaths = await Promise.all(
    ignoredPaths.map(
      (ignoredPath: string): Promise<readonly string[]> =>
        expandIgnoredPath(repositoryRootPath, ignoredPath),
    ),
  );

  return [...new Set(expandedPaths.flat())].toSorted();
}

export { commandOutput, gitPathsFrom, ignoredFilePaths, ignoredIndexPathDetails, repositoryRoot };
