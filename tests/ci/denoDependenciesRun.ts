import { assertEquals, assertRejects, assertStringIncludes } from "@jsr/std__assert";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { runDenoDependencyUpdate } from "coolheadedCi/update/run/denoDependencies.ts";

const success = { code: 0, stderr: "", stdout: "" };
const system = "x86_64-linux";
const buildCommand = [
  "nix",
  "build",
  `.#checks.${system}.denoDependencies`,
  "--no-link",
  "--print-build-logs",
] as const;

async function fixture(): Promise<{
  readonly lock: string;
  readonly output: string;
  readonly previousOutput: string | undefined;
  readonly root: string;
  readonly snapshot: string;
}> {
  const root = await Deno.makeTempDir();
  const lock = `${root}/deno.lock`;
  const output = `${root}/output`;
  const snapshot = `${root}/denoDependencies.nix`;
  const previousOutput = Deno.env.get("GITHUB_OUTPUT");
  await Deno.writeTextFile(lock, JSON.stringify({ specifiers: { "npm:effect@*": "1.0.0" } }));
  await Deno.writeTextFile(output, "");
  await Deno.writeTextFile(snapshot, 'hash = "sha256-old=";\n');
  Deno.env.set("GITHUB_OUTPUT", output);
  return { lock, output, previousOutput, root, snapshot };
}

function restoreOutput(previous: string | undefined): void {
  if (previous === undefined) {
    Deno.env.delete("GITHUB_OUTPUT");
  } else {
    Deno.env.set("GITHUB_OUTPUT", previous);
  }
}

Deno.test("Deno dependency update reports lock and snapshot changes after repair", async () => {
  const files = await fixture();
  const mismatch = "hash mismatch in coolheaded-deno-dependencies\n got: sha256-newSnapshotHash=";
  try {
    const runner = new FakeCommandRunner([
      {
        effect: (): Promise<void> =>
          Deno.writeTextFile(
            files.lock,
            JSON.stringify({ specifiers: { "npm:effect@*": "1.1.0" } }),
          ),
        request: { command: ["deno", "install", "--frozen=false"] },
        result: success,
      },
      {
        request: { command: ["git", "diff", "--quiet", "deno.lock"] },
        result: { code: 1, stderr: "", stdout: "" },
      },
      {
        request: {
          command: ["nix", "eval", "--impure", "--raw", "--expr", "builtins.currentSystem"],
        },
        result: { code: 0, stderr: "", stdout: system },
      },
      {
        request: { command: buildCommand },
        result: { code: 1, stderr: mismatch, stdout: "" },
      },
      {
        request: { command: ["git", "diff", "--name-only"] },
        result: { code: 0, stderr: "", stdout: "deno.lock\nflake/denoDependencies.nix\n" },
      },
    ]);
    await runDenoDependencyUpdate(runner, files.lock, files.snapshot);
    runner.assertExhausted();
    const output = await Deno.readTextFile(files.output);
    assertStringIncludes(output, "updated=true\nnewVersion=Deno dependencies\n");
    assertStringIncludes(output, "npm:effect@*: 1.0.0 -> 1.1.0");
  } finally {
    restoreOutput(files.previousOutput);
    await Deno.remove(files.root, { recursive: true });
  }
});

Deno.test("Deno dependency update stops when lock and snapshot remain unchanged", async () => {
  const files = await fixture();
  try {
    const runner = new FakeCommandRunner([
      { request: { command: ["deno", "install", "--frozen=false"] }, result: success },
      {
        request: { command: ["git", "diff", "--quiet", "deno.lock"] },
        result: success,
      },
      {
        request: {
          command: ["nix", "eval", "--impure", "--raw", "--expr", "builtins.currentSystem"],
        },
        result: { code: 0, stderr: "", stdout: system },
      },
      {
        request: { command: buildCommand },
        result: {
          code: 1,
          stderr: "coolheaded-deno-dependencies\n got: sha256-old=",
          stdout: "",
        },
      },
      {
        request: { command: ["git", "diff", "--quiet", "flake/denoDependencies.nix"] },
        result: success,
      },
    ]);
    await runDenoDependencyUpdate(runner, files.lock, files.snapshot);
    runner.assertExhausted();
    assertEquals(await Deno.readTextFile(files.output), "updated=false\n");
  } finally {
    restoreOutput(files.previousOutput);
    await Deno.remove(files.root, { recursive: true });
  }
});

Deno.test("Deno dependency update restores snapshot and writes no outputs on unexpected success", async () => {
  const files = await fixture();
  try {
    const runner = new FakeCommandRunner([
      { request: { command: ["deno", "install", "--frozen=false"] }, result: success },
      {
        request: { command: ["git", "diff", "--quiet", "deno.lock"] },
        result: success,
      },
      {
        request: {
          command: ["nix", "eval", "--impure", "--raw", "--expr", "builtins.currentSystem"],
        },
        result: { code: 0, stderr: "", stdout: system },
      },
      { request: { command: buildCommand }, result: success },
    ]);
    await assertRejects(() => runDenoDependencyUpdate(runner, files.lock, files.snapshot));
    runner.assertExhausted();
    assertEquals(await Deno.readTextFile(files.snapshot), 'hash = "sha256-old=";\n');
    assertEquals(await Deno.readTextFile(files.output), "");
  } finally {
    restoreOutput(files.previousOutput);
    await Deno.remove(files.root, { recursive: true });
  }
});
