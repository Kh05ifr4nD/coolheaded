import type { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { denoCommandRunner } from "coolheaded/core/denoCommandRunner.ts";
import { isAbsolute } from "@jsr/std__path";

function requiredGitExecutable(): string {
  const executable = Deno.env.get("COOLHEADED_GIT");
  if (executable === undefined || executable.length === 0 || !isAbsolute(executable)) {
    throw new TypeError("COOLHEADED_GIT must be an absolute path");
  }
  return executable;
}

const gitExecutable = requiredGitExecutable();

async function git(
  args: readonly string[],
  cwd?: string,
  gitDir: string | undefined = cwd === undefined ? undefined : `${cwd}/.git`,
): Promise<string> {
  const result = await denoCommandRunner.run({
    command: [gitExecutable, ...args],
    ...(cwd === undefined ? {} : { cwd }),
    ...(gitDir === undefined
      ? {}
      : {
          env: {
            GIT_DIR: gitDir,
            GIT_INDEX_FILE: `${gitDir}/index`,
            ...(cwd === undefined ? {} : { GIT_WORK_TREE: cwd }),
          },
        }),
  });
  if (result.code !== 0) {
    throw new Error(result.stderr);
  }
  return result.stdout.trim();
}

async function initializedRepositories(root: string): Promise<{
  readonly checkout: string;
  readonly remote: string;
  readonly seed: string;
}> {
  const remote = `${root}/remote.git`;
  const seed = `${root}/seed`;
  const checkout = `${root}/checkout`;
  await git(["init", "--bare"], undefined, remote);
  await Deno.mkdir(seed);
  await git(["init"], seed);
  await git(["config", "user.email", "updates@example.invalid"], seed);
  await git(["config", "user.name", "Update Test"], seed);
  await Deno.writeTextFile(`${seed}/tracked.txt`, "base\n");
  await git(["add", "tracked.txt"], seed);
  await git(["commit", "-m", "base"], seed);
  await git(["branch", "-M", "main"], seed);
  await git(["remote", "add", "origin", remote], seed);
  await git(["push", "-u", "origin", "main"], seed);
  await git(["symbolic-ref", "HEAD", "refs/heads/main"], undefined, remote);
  await Deno.mkdir(checkout);
  await git(["init"], checkout);
  await git(["remote", "add", "origin", remote], checkout);
  await git(["fetch", "origin", "main"], checkout);
  await git(["checkout", "-B", "main", "origin/main"], checkout);
  await git(["config", "user.email", "updates@example.invalid"], checkout);
  await git(["config", "user.name", "Update Test"], checkout);
  return { checkout, remote, seed };
}

function realGit(
  command: readonly [string, ...string[]],
  cwd: string,
): ConstructorParameters<typeof FakeCommandRunner>[0][number] {
  return {
    delegateRequest: {
      command: [gitExecutable, ...command.slice(1)],
      cwd,
      env: {
        GIT_DIR: `${cwd}/.git`,
        GIT_INDEX_FILE: `${cwd}/.git/index`,
        GIT_WORK_TREE: cwd,
      },
    },
    request: { command },
    runner: denoCommandRunner,
  };
}

export { git, initializedRepositories, realGit };
