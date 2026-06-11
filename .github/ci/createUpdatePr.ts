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
  return (value ?? "dependencies,automated")
    .split(",")
    .map((label: string): string => label.trim())
    .filter((label: string): boolean => label.length > 0);
}

function parseConfig(args: readonly string[]): UpdatePrConfig {
  const branch = valueAfter(args, "--branch");
  const title = valueAfter(args, "--title");
  const body = valueAfter(args, "--body") ?? "";
  if (branch === undefined || title === undefined) {
    throw new Error("Usage: createUpdatePr.ts --branch <branch> --title <title> [--body <body>]");
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

function gitRemoteHost(remoteUrl: string): string | undefined {
  if (remoteUrl.startsWith("http://") || remoteUrl.startsWith("https://")) {
    return new globalThis.URL(remoteUrl).hostname;
  }

  const sshMatch = /^(?:ssh:\/\/)?(?:[^@]+@)?(?<host>[^/:]+)(?::|\/)/u.exec(remoteUrl);
  const host = sshMatch?.groups?.["host"];
  if (host !== undefined && host.length > 0) {
    return host;
  }

  return undefined;
}

function normalizedServerUrl(serverUrl: string): string | undefined {
  if (serverUrl.length === 0) {
    return undefined;
  }

  const url = new globalThis.URL(serverUrl);
  return `${url.protocol}//${url.host}`;
}

async function gitServerUrl(): Promise<string> {
  const serverUrl = normalizedServerUrl(Deno.env.get("GITHUB_SERVER_URL") ?? "");
  if (serverUrl !== undefined) {
    return serverUrl;
  }

  const remoteUrl = await run(["git", "remote", "get-url", "origin"], { capture: true });
  const host = gitRemoteHost(remoteUrl.stdout);
  if (host === undefined) {
    throw new Error(`Unsupported git remote URL: ${remoteUrl.stdout}`);
  }

  return `https://${host}`;
}

async function gitAuthEnv(): Promise<Readonly<Record<string, string>>> {
  const token = Deno.env.get("GH_TOKEN");
  if (token === undefined) {
    throw new Error("GH_TOKEN is required");
  }

  const encoded = globalThis.btoa(`x-access-token:${token}`);
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.${await gitServerUrl()}/.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${encoded}`,
  };
}

function labelArgs(labels: readonly string[]): readonly string[] {
  return labels.flatMap((label: string): readonly string[] => ["--label", label]);
}

function labelColor(label: string): string {
  switch (label) {
    case "automated": {
      return "ededed";
    }
    case "deno-deps": {
      return "3178c6";
    }
    case "dependencies": {
      return "0366d6";
    }
    case "flake-input": {
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

async function createOrUpdatePr(config: UpdatePrConfig): Promise<void> {
  if (config.dryRun) {
    await writeStdout(JSON.stringify(config, null, 2));
    return;
  }

  await run(["git", "add", "."], { capture: false });
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
    env: await gitAuthEnv(),
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
          "main",
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

export { createOrUpdatePr, gitAuthEnv, gitRemoteHost, parseConfig };
export type { UpdatePrConfig };
