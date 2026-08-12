import { git, initializedRepositories, realGit } from "./updateGitFixture.ts";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { assertEquals } from "@jsr/std__assert";
import { prepareBranch } from "coolheadedCi/update/branch.ts";

async function pushBranch(
  seed: string,
  branch: string,
  file: string,
  content: string,
): Promise<void> {
  await git(["checkout", "-B", branch, "main"], seed);
  await Deno.writeTextFile(`${seed}/${file}`, content);
  await git(["add", file], seed);
  await git(["commit", "-m", branch], seed);
  await git(["push", "origin", `${branch}:${branch}`], seed);
}

function existingBranchCommands(
  checkout: string,
  branch: string,
  conflict: boolean,
): ConstructorParameters<typeof FakeCommandRunner>[0] {
  return [
    realGit(["git", "fetch", "origin", "main"], checkout),
    realGit(["git", "fetch", "origin", branch], checkout),
    realGit(["git", "checkout", "-B", branch, `origin/${branch}`], checkout),
    realGit(["git", "rebase", "origin/main"], checkout),
    ...(conflict
      ? [
          realGit(["git", "rebase", "--abort"], checkout),
          realGit(["git", "checkout", "-B", branch, "origin/main"], checkout),
        ]
      : []),
  ];
}

Deno.test("existing update branch rebases onto main with clean combined tree", async () => {
  const root = await Deno.makeTempDir();
  try {
    const { checkout, seed } = await initializedRepositories(root);
    const branch = "update/package/rebase";
    await pushBranch(seed, branch, "branch.txt", "branch\n");
    await git(["checkout", "main"], seed);
    await Deno.writeTextFile(`${seed}/main.txt`, "main\n");
    await git(["add", "main.txt"], seed);
    await git(["commit", "-m", "main"], seed);
    await git(["push", "origin", "main"], seed);

    const runner = new FakeCommandRunner(existingBranchCommands(checkout, branch, false));
    await prepareBranch(branch, runner);
    runner.assertExhausted();
    assertEquals(await git(["status", "--porcelain"], checkout), "");
    assertEquals(await Deno.readTextFile(`${checkout}/branch.txt`), "branch\n");
    assertEquals(await Deno.readTextFile(`${checkout}/main.txt`), "main\n");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("conflicting update branch aborts rebase then falls back to main", async () => {
  const root = await Deno.makeTempDir();
  try {
    const { checkout, seed } = await initializedRepositories(root);
    const branch = "update/package/conflict";
    await pushBranch(seed, branch, "tracked.txt", "branch\n");
    await git(["checkout", "main"], seed);
    await Deno.writeTextFile(`${seed}/tracked.txt`, "main\n");
    await git(["add", "tracked.txt"], seed);
    await git(["commit", "-m", "main"], seed);
    await git(["push", "origin", "main"], seed);

    const runner = new FakeCommandRunner(existingBranchCommands(checkout, branch, true));
    await prepareBranch(branch, runner);
    runner.assertExhausted();
    assertEquals(await git(["status", "--porcelain"], checkout), "");
    assertEquals(
      await git(["rev-parse", "HEAD"], checkout),
      await git(["rev-parse", "origin/main"], checkout),
    );
    assertEquals(await Deno.readTextFile(`${checkout}/tracked.txt`), "main\n");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
