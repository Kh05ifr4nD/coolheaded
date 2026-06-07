#!/usr/bin/env -S deno run --allow-run

import { run } from "./lib.ts";

async function prepareUpdateBranch(branch: string): Promise<void> {
  await run(["git", "fetch", "origin", "main"], { capture: false });
  await run(["git", "fetch", "origin", branch], {
    capture: false,
    check: false,
  });
  await run(["git", "checkout", "-B", branch, "origin/main"], {
    capture: false,
  });
}

async function main(args: readonly string[]): Promise<void> {
  const [branch] = args;
  if (branch === undefined || branch.length === 0) {
    throw new Error("Usage: prepareUpdateBranch.ts <branch>");
  }

  await prepareUpdateBranch(branch);
}

if (import.meta.main) {
  void main(Deno.args);
}

export { prepareUpdateBranch };
