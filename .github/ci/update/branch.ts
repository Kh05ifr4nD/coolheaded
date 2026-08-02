#!/usr/bin/env -S deno run --allow-run

import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { denoCommandRunner } from "coolheaded/core/denoCommandRunner.ts";
import { run } from "coolheadedCi/process.ts";

const DEFAULT_BASE_REF = "main";

async function prepareBranch(
  branch: string,
  runner: CommandRunner,
  baseRef = DEFAULT_BASE_REF,
): Promise<void> {
  await run(runner, ["git", "fetch", "origin", baseRef], { capture: false });
  const existingBranch = await run(runner, ["git", "fetch", "origin", branch], {
    capture: false,
    check: false,
  });
  if (existingBranch.code === 0) {
    await run(runner, ["git", "checkout", "-B", branch, `origin/${branch}`], {
      capture: false,
    });
    const rebase = await run(runner, ["git", "rebase", `origin/${baseRef}`], {
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

  await run(runner, ["git", "checkout", "-B", branch, `origin/${baseRef}`], {
    capture: false,
  });
}

async function main(args: readonly string[]): Promise<void> {
  const [branch, baseRef = DEFAULT_BASE_REF] = args;
  if (branch === undefined || branch.length === 0) {
    throw new Error("Usage: branch.ts <branch>");
  }

  await prepareBranch(branch, denoCommandRunner, baseRef);
}

if (import.meta.main) {
  void main(Deno.args);
}

export { prepareBranch };
