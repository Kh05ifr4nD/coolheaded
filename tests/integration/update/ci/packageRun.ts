import { assertEquals, assertInstanceOf, assertRejects } from "@jsr/std__assert";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { UpdateError } from "coolheaded/core/updateScript.ts";
import { runPackage } from "coolheadedCi/update/run/package.ts";

const success = { code: 0, stderr: "", stdout: "" };
const name = "example";
const system = "x86_64-linux";
const updateCommand = [
  "deno",
  "run",
  "--allow-env",
  "--allow-net",
  "--allow-read",
  "--allow-run",
  "--allow-write",
  `packages/${name}/update.ts`,
] as const;
const allowedFilesExpression = `
let
  config = builtins.fromJSON (builtins.getEnv "PACKAGE_UPDATE_CONFIG");
  flake = builtins.getFlake (toString ./.);
  package = builtins.getAttr config.name flake.packages.\${config.system};
in
  package.passthru.updateAllowedFiles or []
`;

async function outputFixture(): Promise<{
  readonly output: string;
  readonly previousOutput: string | undefined;
  readonly root: string;
}> {
  const root = await Deno.makeTempDir();
  const output = `${root}/output`;
  const previousOutput = Deno.env.get("GITHUB_OUTPUT");
  await Deno.writeTextFile(output, "");
  Deno.env.set("GITHUB_OUTPUT", output);
  return { output, previousOutput, root };
}

function restoreOutput(previous: string | undefined): void {
  if (previous === undefined) {
    Deno.env.delete("GITHUB_OUTPUT");
  } else {
    Deno.env.set("GITHUB_OUTPUT", previous);
  }
}

function changedPrefix(files: string): ConstructorParameters<typeof FakeCommandRunner>[0] {
  return [
    { request: { command: updateCommand }, result: success },
    {
      request: { command: ["git", "diff", "--quiet"] },
      result: { code: 1, stderr: "", stdout: "" },
    },
    {
      request: {
        command: ["nix", "eval", "--impure", "--raw", "--expr", "builtins.currentSystem"],
      },
      result: { code: 0, stderr: "", stdout: system },
    },
    {
      request: {
        command: ["nix", "eval", "--json", "--impure", "--expr", allowedFilesExpression],
        env: { PACKAGE_UPDATE_CONFIG: JSON.stringify({ name, system }) },
      },
      result: { code: 0, stderr: "", stdout: "[]" },
    },
    {
      request: { command: ["git", "diff", "--name-only"] },
      result: { code: 0, stderr: "", stdout: files },
    },
  ];
}

Deno.test("package update stops without evaluation when updater changes nothing", async () => {
  const fixture = await outputFixture();
  try {
    const runner = new FakeCommandRunner([
      { request: { command: updateCommand }, result: success },
      { request: { command: ["git", "diff", "--quiet"] }, result: success },
    ]);
    await runPackage(name, runner, undefined, "1.0.0");
    runner.assertExhausted();
    assertEquals(await Deno.readTextFile(fixture.output), "updated=false\n");
  } finally {
    restoreOutput(fixture.previousOutput);
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("package update validates changes and version before publishing outputs", async () => {
  const fixture = await outputFixture();
  const attr = `.#packages.${system}.${JSON.stringify(name)}`;
  try {
    const runner = new FakeCommandRunner([
      ...changedPrefix(`packages/${name}/pin.json\n`),
      {
        request: { command: ["nix", "eval", "--raw", `${attr}.version`] },
        result: { code: 0, stderr: "", stdout: "1.1.0" },
      },
      {
        request: { command: ["nix", "eval", "--raw", `${attr}.meta.changelog`] },
        result: { code: 1, stderr: "missing", stdout: "" },
      },
    ]);
    await runPackage(name, runner, undefined, "1.0.0");
    runner.assertExhausted();
    assertEquals(
      await Deno.readTextFile(fixture.output),
      "updated=true\nnewVersion=1.1.0\nchangelog=\n",
    );
  } finally {
    restoreOutput(fixture.previousOutput);
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("package update writes no success output for unrelated changes", async () => {
  const fixture = await outputFixture();
  try {
    const runner = new FakeCommandRunner(changedPrefix("README.md\n"));
    await assertRejects(() => runPackage(name, runner, undefined, "1.0.0"));
    runner.assertExhausted();
    assertEquals(await Deno.readTextFile(fixture.output), "");
  } finally {
    restoreOutput(fixture.previousOutput);
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("package update rejects a nonadvanced version before success outputs", async () => {
  const fixture = await outputFixture();
  const attr = `.#packages.${system}.${JSON.stringify(name)}`;
  try {
    const runner = new FakeCommandRunner([
      ...changedPrefix(`packages/${name}/pin.json\n`),
      {
        request: { command: ["nix", "eval", "--raw", `${attr}.version`] },
        result: { code: 0, stderr: "", stdout: "1.0.0" },
      },
    ]);
    const error = await assertRejects(() => runPackage(name, runner, undefined, "1.0.0"));
    assertInstanceOf(error, UpdateError);
    runner.assertExhausted();
    assertEquals(await Deno.readTextFile(fixture.output), "");
  } finally {
    restoreOutput(fixture.previousOutput);
    await Deno.remove(fixture.root, { recursive: true });
  }
});
