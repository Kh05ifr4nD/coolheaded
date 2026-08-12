import { assertEquals, assertRejects } from "@jsr/std__assert";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { runFlakeInput } from "coolheadedCi/update/run/flakeInput.ts";

const success = { code: 0, stderr: "", stdout: "" };
const system = "x86_64-linux";
const buildCommand = [
  "nix",
  "build",
  `.#checks.${system}.denoDependencies`,
  "--no-link",
  "--print-build-logs",
] as const;

async function outputFixture(): Promise<{
  readonly lock: string;
  readonly output: string;
  readonly previousOutput: string | undefined;
  readonly root: string;
  readonly snapshot: string;
}> {
  const root = await Deno.makeTempDir();
  const lock = `${root}/flake.lock`;
  const output = `${root}/output`;
  const snapshot = `${root}/denoDependencies.nix`;
  const previousOutput = Deno.env.get("GITHUB_OUTPUT");
  await Deno.writeTextFile(
    lock,
    JSON.stringify({ nodes: { example: { locked: { rev: "1234567890abcdef" } } } }),
  );
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

Deno.test("flake input update stops without later commands when lock is unchanged", async () => {
  const fixture = await outputFixture();
  try {
    const runner = new FakeCommandRunner([
      { request: { command: ["nix", "flake", "update", "example"] }, result: success },
      {
        request: { command: ["git", "diff", "--quiet", "flake.lock"] },
        result: success,
      },
    ]);
    await runFlakeInput("example", runner, fixture.lock, fixture.snapshot);
    runner.assertExhausted();
    assertEquals(await Deno.readTextFile(fixture.output), "updated=false\n");
  } finally {
    restoreOutput(fixture.previousOutput);
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("flake input update repairs only a Deno snapshot mismatch before outputs", async () => {
  const fixture = await outputFixture();
  const mismatch = "hash mismatch in coolheaded-deno-dependencies\n got: sha256-newSnapshotHash=";
  try {
    const runner = new FakeCommandRunner([
      { request: { command: ["nix", "flake", "update", "example"] }, result: success },
      {
        request: { command: ["git", "diff", "--quiet", "flake.lock"] },
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
        request: { command: buildCommand },
        result: { code: 1, stderr: mismatch, stdout: "" },
      },
      {
        request: { command: ["git", "diff", "--name-only"] },
        result: { code: 0, stderr: "", stdout: "flake.lock\nflake/denoDependencies.nix\n" },
      },
    ]);
    await runFlakeInput("example", runner, fixture.lock, fixture.snapshot);
    runner.assertExhausted();
    assertEquals(await Deno.readTextFile(fixture.snapshot), 'hash = "sha256-newSnapshotHash=";\n');
    assertEquals(
      await Deno.readTextFile(fixture.output),
      "updated=true\nnewVersion=12345678\nchangelog=\n",
    );
  } finally {
    restoreOutput(fixture.previousOutput);
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("flake input update rejects unrelated snapshot failures before outputs", async () => {
  const fixture = await outputFixture();
  try {
    const runner = new FakeCommandRunner([
      { request: { command: ["nix", "flake", "update", "example"] }, result: success },
      {
        request: { command: ["git", "diff", "--quiet", "flake.lock"] },
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
        result: { code: 1, stderr: "unrelated failure", stdout: "" },
      },
    ]);
    await assertRejects(() => runFlakeInput("example", runner, fixture.lock, fixture.snapshot));
    runner.assertExhausted();
    assertEquals(await Deno.readTextFile(fixture.output), "");
  } finally {
    restoreOutput(fixture.previousOutput);
    await Deno.remove(fixture.root, { recursive: true });
  }
});
