#!/usr/bin/env -S deno run --allow-env --allow-run

import { isRecord, run, writeStdout } from "coolheadedCi/process.ts";

const BASE_BRANCH = "main";

interface PullRequestConfig {
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
  return (value ?? "dependencies,automated")
    .split(",")
    .map((label: string): string => label.trim())
    .filter((label: string): boolean => label.length > 0);
}

function parseConfig(args: readonly string[]): PullRequestConfig {
  const branch = valueAfter(args, "--branch");
  const title = valueAfter(args, "--title");
  const body = valueAfter(args, "--body") ?? "";
  if (branch === undefined || title === undefined) {
    throw new Error("Usage: pullRequest.ts --branch <branch> --title <title> [--body <body>]");
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
  const result = await run(
    ["gh", "pr", "list", "--head", branch, "--json", "number", "--jq", ".[0].number // empty"],
    { capture: true },
  );

  return result.stdout.length === 0 ? undefined : result.stdout;
}

function labelArgs(labels: readonly string[]): readonly string[] {
  return labels.flatMap((label: string): readonly string[] => ["--label", label]);
}

function labelColor(label: string): string {
  switch (label) {
    case "automated": {
      return "ededed";
    }
    case "denoDependencies": {
      return "3178c6";
    }
    case "dependencies": {
      return "0366d6";
    }
    case "flakeInput": {
      return "5319e7";
    }
    case "package": {
      return "0e8a16";
    }
    default: {
      return "ededed";
    }
  }
}

function repositoryName(): string {
  const repository = Deno.env.get("GITHUB_REPOSITORY");
  if (repository === undefined || repository.length === 0) {
    throw new Error("GITHUB_REPOSITORY is required to enable auto-merge");
  }

  return repository;
}

function arrayHasRequiredStatusChecks(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function classicProtectionHasRequiredChecks(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const { checks, contexts } = value;
  return arrayHasRequiredStatusChecks(contexts) || arrayHasRequiredStatusChecks(checks);
}

function rulesetAppliesToBranch(value: Readonly<Record<string, unknown>>, branch: string): boolean {
  const { conditions } = value;
  if (!isRecord(conditions)) {
    return true;
  }

  const { ref_name: refName } = conditions;
  if (!isRecord(refName)) {
    return true;
  }

  const { include } = refName;
  return (
    !Array.isArray(include) ||
    include.some(
      (pattern: unknown): boolean =>
        pattern === "~DEFAULT_BRANCH" || pattern === branch || pattern === `refs/heads/${branch}`,
    )
  );
}

function rulesetHasRequiredChecks(value: unknown, branch: string): boolean {
  if (!isRecord(value) || value["target"] !== "branch" || value["enforcement"] !== "active") {
    return false;
  }
  if (!rulesetAppliesToBranch(value, branch)) {
    return false;
  }

  const { rules } = value;
  if (!Array.isArray(rules)) {
    return false;
  }

  return rules.some((rule: unknown): boolean => {
    if (!isRecord(rule) || rule["type"] !== "required_status_checks") {
      return false;
    }

    const { parameters } = rule;
    return (
      isRecord(parameters) && arrayHasRequiredStatusChecks(parameters["required_status_checks"])
    );
  });
}

async function classicProtectionReady(repository: string, branch: string): Promise<boolean> {
  const result = await run(
    ["gh", "api", `repos/${repository}/branches/${branch}/protection/required_status_checks`],
    { capture: true, check: false },
  );
  return result.code === 0 && classicProtectionHasRequiredChecks(JSON.parse(result.stdout));
}

async function activeRulesetIds(repository: string): Promise<readonly number[]> {
  const result = await run(["gh", "api", `repos/${repository}/rulesets`], { capture: true });
  const value = JSON.parse(result.stdout);
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((ruleset: unknown): readonly number[] => {
    if (!isRecord(ruleset)) {
      return [];
    }

    const { enforcement, id, target } = ruleset;
    return target === "branch" && enforcement === "active" && typeof id === "number" ? [id] : [];
  });
}

async function rulesetProtectionReady(repository: string, branch: string): Promise<boolean> {
  const ids = await activeRulesetIds(repository);
  const results = await Promise.all(
    ids.map(async (id: number): Promise<boolean> => {
      const result = await run(["gh", "api", `repos/${repository}/rulesets/${id}`], {
        capture: true,
        check: false,
      });
      return result.code === 0 && rulesetHasRequiredChecks(JSON.parse(result.stdout), branch);
    }),
  );

  return results.some(Boolean);
}

async function assertAutoMergeGateReady(branch: string): Promise<void> {
  const repository = repositoryName();
  const ready =
    (await classicProtectionReady(repository, branch)) ||
    (await rulesetProtectionReady(repository, branch));
  if (!ready) {
    throw new Error(
      `Auto-merge requires required status checks on ${branch}; configure branch protection before enabling auto-merge.`,
    );
  }
}

async function ensureLabels(labels: readonly string[]): Promise<void> {
  await Promise.all(
    labels.map(
      (label: string): Promise<unknown> =>
        run(
          [
            "gh",
            "label",
            "create",
            label,
            "--color",
            labelColor(label),
            "--description",
            "Managed by update automation",
            "--force",
          ],
          {
            capture: false,
          },
        ),
    ),
  );
}

async function createOrUpdatePullRequest(config: PullRequestConfig): Promise<void> {
  if (config.dryRun) {
    await writeStdout(JSON.stringify(config, null, 2));
    return;
  }

  await run(["git", "add", "--update"], { capture: false });
  const diff = await run(["git", "diff", "--cached", "--quiet"], {
    check: false,
  });
  if (diff.code === 0) {
    return;
  }

  await run(["git", "commit", "--signoff", "-m", config.title, "-m", config.body], {
    capture: false,
  });
  await run(["git", "push", "--force-with-lease", "origin", `HEAD:${config.branch}`], {
    capture: false,
  });

  const prNumber = await existingPrNumber(config.branch);
  await ensureLabels(config.labels);
  const prCommand =
    prNumber === undefined
      ? [
          "gh",
          "pr",
          "create",
          "--base",
          BASE_BRANCH,
          "--head",
          config.branch,
          "--title",
          config.title,
          "--body",
          config.body,
          ...labelArgs(config.labels),
        ]
      : ["gh", "pr", "edit", prNumber, "--title", config.title, "--body", config.body];
  await run(prCommand, { capture: false });

  const updatedPrNumber = prNumber ?? (await existingPrNumber(config.branch));
  if (config.autoMerge && updatedPrNumber !== undefined) {
    await assertAutoMergeGateReady(BASE_BRANCH);
    await run(["gh", "pr", "merge", updatedPrNumber, "--auto", "--squash"], { capture: false });
  }
}

async function main(args: readonly string[]): Promise<void> {
  await createOrUpdatePullRequest(parseConfig(args));
}

if (import.meta.main) {
  void main(Deno.args);
}

export {
  classicProtectionHasRequiredChecks,
  createOrUpdatePullRequest,
  parseConfig,
  rulesetHasRequiredChecks,
};
export type { PullRequestConfig };
