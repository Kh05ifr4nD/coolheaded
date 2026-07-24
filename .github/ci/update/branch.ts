#!/usr/bin/env -S deno run --allow-run

import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { denoCommandRunner } from "coolheaded/core/denoCommandRunner.ts";
import { run } from "coolheadedCi/process.ts";

async function prepareBranch(branch: string, runner: CommandRunner): Promise<void> {
  await run(runner, ["git", "fetch", "origin", "main"], { capture: false });
  const existingBranch = await run(runner, ["git", "fetch", "origin", branch], {
    capture: false,
    check: false,
  });
  if (existingBranch.code === 0) {
    await run(runner, ["git", "checkout", "-B", branch, `origin/${branch}`], {
      capture: false,
    });
    const rebase = await run(runner, ["git", "rebase", "origin/main"], {
      capture: false,
      check: false,
    });
    if (rebase.code === 0) {
      return;
    }

    await run(runner, ["git", "rebase", "--abort"], {
      capture: false,
      check: false,
    });
  }

  await run(runner, ["git", "checkout", "-B", branch, "origin/main"], {
    capture: false,
  });
}

async function main(args: readonly string[]): Promise<void> {
  const [branch] = args;
  if (branch === undefined || branch.length === 0) {
    throw new Error("Usage: branch.ts <branch>");
  }

  await prepareBranch(branch, denoCommandRunner);
}

if (import.meta.main) {
  void main(Deno.args);
}

export { prepareBranch };
