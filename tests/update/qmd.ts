import type { CommandRequest, CommandRunner } from "coolheaded/core/commandRunner.ts";
import { assertEquals, assertInstanceOf, assertStrictEquals } from "@jsr/std__assert";
import { Effect } from "effect";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { UpdateError } from "coolheaded/core/updateScript.ts";
import { strictJsonClient } from "coolheadedTestSupport/httpClient.ts";
import { updateProgram } from "coolheadedPackageQmd";

const VERSION = "1.2.3";
const COMMAND_FAILURE = 23;
const COMMAND_OK = { code: 0, stderr: "", stdout: "" };
const BUN2NIX_OUT = "/nix/store/bun2nix";
const BUN_NIX = "{ fetchurl }: fetchurl {}";
const SOURCE_HASH = "sha256-SOURCE";
const PIN_SENTINEL_BYTE = 255;
const GENERATED_SENTINEL_BYTE = 254;
type Dependencies = Parameters<typeof updateProgram>[1];

function sourceExpression(repositoryRootPath: string): string {
  return `\nlet\n  flake = builtins.getFlake "path:${repositoryRootPath}";\n  pkgs = import flake.inputs.nixpkgs { system = builtins.currentSystem; };\nin\npkgs.fetchFromGitHub {\n  owner = "tobi";\n  repo = "qmd";\n  tag = "v${VERSION}";\n  hash = pkgs.lib.fakeHash;\n}\n`;
}

function dependencies(
  generatedPackageFilePath: string,
  pinFilePath: string,
  repositoryRootPath: string,
  runner: Readonly<CommandRunner>,
): Dependencies {
  return {
    generatedPackageFilePath,
    jsonClient: strictJsonClient([]).client,
    pinFilePath,
    repositoryRootPath,
    runner,
  };
}

Deno.test("QMD update generates bun package, source pin, and format request", async (): Promise<void> => {
  const directory = await Deno.makeTempDir();
  const generatedPackageFilePath = `${directory}/generatedPackage.nix`;
  const pinFilePath = `${directory}/pin.json`;
  const runner = new FakeCommandRunner([
    {
      request: {
        command: [
          "nix",
          "build",
          "--no-link",
          "--print-out-paths",
          "--inputs-from",
          directory,
          "bun2nix#bun2nix",
        ],
      },
      result: { ...COMMAND_OK, stdout: BUN2NIX_OUT },
    },
    {
      assertRequest(request: CommandRequest): void {
        const archivePath = request.command.at(-1);
        if (archivePath === undefined) {
          throw new TypeError("curl request requires output");
        }
        assertEquals(request, {
          command: [
            "curl",
            "-fsSL",
            `https://github.com/tobi/qmd/archive/refs/tags/v${VERSION}.tar.gz`,
            "-o",
            archivePath,
          ],
        });
        assertEquals(archivePath.endsWith("/source.tgz"), true);
      },
      result: COMMAND_OK,
    },
    {
      assertRequest(request: CommandRequest): void {
        const workspacePath = request.cwd;
        if (workspacePath === undefined) {
          throw new TypeError("tar request requires cwd");
        }
        assertEquals(request, {
          command: ["tar", "-xzf", `${workspacePath}/source.tgz`, "--strip-components=1"],
          cwd: workspacePath,
        });
      },
      result: COMMAND_OK,
    },
    {
      assertRequest(request: CommandRequest): void {
        const workspacePath = request.cwd;
        if (workspacePath === undefined) {
          throw new TypeError("bun2nix request requires cwd");
        }
        assertEquals(request, {
          command: [`${BUN2NIX_OUT}/bin/bun2nix`, "-o", `${workspacePath}/generatedPackage.nix`],
          cwd: workspacePath,
        });
      },
      result: COMMAND_OK,
    },
    {
      assertRequest(request: CommandRequest): void {
        const [, generatedPath] = request.command;
        if (generatedPath === undefined) {
          throw new TypeError("cat request requires generated path");
        }
        assertEquals(request, { command: ["cat", generatedPath] });
        assertEquals(generatedPath.endsWith("/generatedPackage.nix"), true);
      },
      result: { ...COMMAND_OK, stdout: BUN_NIX },
    },
    {
      request: {
        command: ["nix", "build", "--impure", "--no-link", "--expr", sourceExpression(directory)],
        cwd: directory,
      },
      result: { code: 1, stderr: `error: got: ${SOURCE_HASH}`, stdout: "" },
    },
    {
      request: { command: ["nix", "fmt", "--", generatedPackageFilePath] },
      result: COMMAND_OK,
    },
  ]);
  try {
    await Effect.runPromise(
      updateProgram(
        [VERSION],
        dependencies(generatedPackageFilePath, pinFilePath, directory, runner),
      ),
    );
    assertEquals(
      await Deno.readTextFile(pinFilePath),
      `{\n  "version": "${VERSION}",\n  "sourceHash": "${SOURCE_HASH}"\n}\n`,
    );
    assertEquals(await Deno.readTextFile(generatedPackageFilePath), `${BUN_NIX}\n`);
    const calls = runner.calls();
    const workspacePath = calls[2]?.cwd;
    assertEquals(calls[1]?.command.at(-1), `${workspacePath}/source.tgz`);
    assertEquals(calls[3]?.cwd, workspacePath);
    assertEquals(calls[4]?.command[1], `${workspacePath}/generatedPackage.nix`);
    runner.assertExhausted();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("QMD update preserves pin and generated bytes when bun2nix build fails", async (): Promise<void> => {
  const directory = await Deno.makeTempDir();
  const generatedPackageFilePath = `${directory}/generatedPackage.nix`;
  const pinFilePath = `${directory}/pin.json`;
  const pinSentinel = new Uint8Array([0, PIN_SENTINEL_BYTE, 1]);
  const generatedSentinel = new Uint8Array([2, GENERATED_SENTINEL_BYTE, 3]);
  await Deno.writeFile(pinFilePath, pinSentinel);
  await Deno.writeFile(generatedPackageFilePath, generatedSentinel);
  const failureResult = { code: COMMAND_FAILURE, stderr: "bun2nix failed", stdout: "" };
  const runner = new FakeCommandRunner([
    {
      request: {
        command: [
          "nix",
          "build",
          "--no-link",
          "--print-out-paths",
          "--inputs-from",
          directory,
          "bun2nix#bun2nix",
        ],
      },
      result: failureResult,
    },
  ]);
  try {
    const update = updateProgram(
      [VERSION],
      dependencies(generatedPackageFilePath, pinFilePath, directory, runner),
    );
    const error = await Effect.runPromise(Effect.flip(update));
    assertInstanceOf(error, UpdateError);
    assertEquals(error.message, "Failed to run nix: exit 23: bun2nix failed");
    assertEquals(await Deno.readFile(pinFilePath), pinSentinel);
    assertEquals(await Deno.readFile(generatedPackageFilePath), generatedSentinel);
    assertStrictEquals(runner.observations()[0]?.result, failureResult);
    runner.assertExhausted();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
