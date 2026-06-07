#!/usr/bin/env -S deno run --allow-env --allow-run

import { run, writeStdout } from "./lib.ts";

interface UpdatePrConfig {
  readonly autoMerge: boolean;
  readonly body: string;
  readonly branch: string;
  readonly dryRun: boolean;
  readonly labels: readonly string[];
  readonly title: string;
}

function valueAfter(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  return value;
}

function labelsFrom(value: string | undefined): readonly string[] {
  return (value ?? "dependencies,automated").split(",").map((
    label: string,
  ): string => label.trim()).filter((label: string): boolean =>
    label.length > 0
  );
}

function parseConfig(args: readonly string[]): UpdatePrConfig {
  const branch = valueAfter(args, "--branch");
  const title = valueAfter(args, "--title");
  const body = valueAfter(args, "--body") ?? "";
  if (branch === undefined || title === undefined) {
    throw new Error(
      "Usage: createUpdatePr.ts --branch <branch> --title <title> [--body <body>]",
    );
  }

  return {
    autoMerge: valueAfter(args, "--auto-merge") !== "false",
    body,
    branch,
    dryRun: args.includes("--dry-run"),
    labels: labelsFrom(valueAfter(args, "--labels")),
    title,
  };
}

async function existingPrNumber(branch: string): Promise<string | undefined> {
  const result = await run([
    "gh",
    "pr",
    "list",
    "--head",
    branch,
    "--json",
    "number",
    "--jq",
    ".[0].number // empty",
  ], { capture: true });

  return result.stdout.length === 0 ? undefined : result.stdout;
}

function labelArgs(labels: readonly string[]): readonly string[] {
  return labels.flatMap((label: string): readonly string[] => [
    "--label",
    label,
  ]);
}

async function createOrUpdatePr(config: UpdatePrConfig): Promise<void> {
  if (config.dryRun) {
    await writeStdout(JSON.stringify(config, null, 2));
    return;
  }

  if (Deno.env.get("GH_TOKEN") === undefined) {
    throw new Error("GH_TOKEN is required");
  }

  await run(["git", "add", "."], { capture: false });
  const diff = await run(["git", "diff", "--cached", "--quiet"], {
    check: false,
  });
  if (diff.code === 0) {
    return;
  }

  await run([
    "git",
    "commit",
    "--signoff",
    "-m",
    config.title,
    "-m",
    config.body,
  ], {
    capture: false,
  });
  await run([
    "git",
    "push",
    "--force-with-lease",
    "origin",
    `HEAD:${config.branch}`,
  ], {
    capture: false,
  });

  const prNumber = await existingPrNumber(config.branch);
  const prCommand = prNumber === undefined
    ? [
      "gh",
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      config.branch,
      "--title",
      config.title,
      "--body",
      config.body,
      ...labelArgs(config.labels),
    ]
    : [
      "gh",
      "pr",
      "edit",
      prNumber,
      "--title",
      config.title,
      "--body",
      config.body,
    ];
  await run(prCommand, { capture: false });

  const updatedPrNumber = prNumber ?? await existingPrNumber(config.branch);
  if (config.autoMerge && updatedPrNumber !== undefined) {
    await run(["gh", "pr", "merge", updatedPrNumber, "--auto", "--squash"], {
      capture: false,
      check: false,
    });
  }
}

async function main(args: readonly string[]): Promise<void> {
  await createOrUpdatePr(parseConfig(args));
}

if (import.meta.main) {
  void main(Deno.args);
}

export { createOrUpdatePr, parseConfig };
export type { UpdatePrConfig };
