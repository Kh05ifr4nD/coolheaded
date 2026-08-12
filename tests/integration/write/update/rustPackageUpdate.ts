import { assertEquals, assertStrictEquals, assertStringIncludes } from "@jsr/std__assert";
import type { CommandRequest } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { updateGitHubRustPackagePin } from "coolheaded/update/rustPackage.ts";

const VERSION = "1.2.3";
const ROOT = "/repository";
const SOURCE_HASH = "sha256-example";
const CARGO_HASH = "sha256-vendor";
const PIN_SENTINEL = new globalThis.TextEncoder().encode('{"version":"1.0.0"}\n');

function options(
  pinFilePath: string,
  runner: Readonly<FakeCommandRunner>,
  args: readonly string[] = [VERSION],
  latestVersion: () => Effect.Effect<string, Error> = (): Effect.Effect<string, Error> =>
    Effect.succeed(VERSION),
): Parameters<typeof updateGitHubRustPackagePin>[0] {
  return {
    args,
    latestVersion,
    package: {
      owner: "example",
      pname: "tool",
      repo: "tool",
      tag: (version: string): string => `v${version}`,
    },
    pinFilePath,
    repositoryRootPath: ROOT,
    runner,
  } as const;
}

Deno.test("Rust package update writes source and cargo vendor hashes", async (): Promise<void> => {
  const directory = await Deno.makeTempDir();
  const pinFilePath = `${directory}/pin.json`;
  const runner = new FakeCommandRunner([
    {
      assertRequest(request: CommandRequest): void {
        assertEquals(request.command.slice(0, 5), [
          "nix",
          "build",
          "--impure",
          "--no-link",
          "--expr",
        ]);
        assertEquals(request.cwd, ROOT);
        const expression = request.command.at(5);
        if (expression === undefined) {
          throw new TypeError("source prefetch requires expression");
        }
        assertStringIncludes(expression, 'owner = "example"');
        assertStringIncludes(expression, 'repo = "tool"');
        assertStringIncludes(expression, 'tag = "v1.2.3"');
        assertStringIncludes(expression, "hash = pkgs.lib.fakeHash");
      },
      result: { code: 1, stderr: `error: got: ${SOURCE_HASH}`, stdout: "" },
    },
    {
      assertRequest(request: CommandRequest): void {
        assertEquals(request.command.slice(0, 5), [
          "nix",
          "build",
          "--impure",
          "--no-link",
          "--expr",
        ]);
        assertEquals(request.cwd, ROOT);
        const expression = request.command.at(5);
        if (expression === undefined) {
          throw new TypeError("cargo prefetch requires expression");
        }
        assertStringIncludes(expression, 'pname = "tool"');
        assertStringIncludes(expression, `version = "${VERSION}"`);
        assertStringIncludes(expression, `hash = "${SOURCE_HASH}"`);
        assertStringIncludes(expression, "cargoHash = pkgs.lib.fakeHash");
      },
      result: { code: 1, stderr: `error: got: ${CARGO_HASH}`, stdout: "" },
    },
  ]);
  try {
    await Effect.runPromise(updateGitHubRustPackagePin(options(pinFilePath, runner)));
    assertEquals(
      await Deno.readTextFile(pinFilePath),
      `{\n  "version": "${VERSION}",\n  "sourceHash": "${SOURCE_HASH}",\n  "cargoVendorHash": "${CARGO_HASH}"\n}\n`,
    );
    runner.assertExhausted();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Rust package update preserves pin and latest-version error identity", async (): Promise<void> => {
  const directory = await Deno.makeTempDir();
  const pinFilePath = `${directory}/pin.json`;
  await Deno.writeFile(pinFilePath, PIN_SENTINEL);
  const runner = new FakeCommandRunner([]);
  const error = new Error("latest version unavailable");
  try {
    const updateEffect = updateGitHubRustPackagePin(
      options(pinFilePath, runner, [], (): Effect.Effect<string, Error> => Effect.fail(error)),
    );
    const failureEffect = Effect.flip(updateEffect);
    const failure = await Effect.runPromise(failureEffect);
    assertStrictEquals(failure, error);
    assertEquals(await Deno.readFile(pinFilePath), PIN_SENTINEL);
    runner.assertExhausted();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
