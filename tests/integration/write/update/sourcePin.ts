import { assertEquals, assertStrictEquals, assertStringIncludes } from "@jsr/std__assert";
import { Effect } from "effect";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { updateGitHubSourcePin } from "coolheaded/source/github.ts";

const VERSION = "1.2.3";
const SOURCE_HASH = "sha256-example";
const ROOT = "/repository";
const PIN_SENTINEL = new globalThis.TextEncoder().encode('{"version":"1.0.0"}\n');

function options(
  pinFilePath: string,
  runner: Readonly<FakeCommandRunner>,
  args: readonly string[] = [VERSION],
  latestVersion: () => Effect.Effect<string, Error> = (): Effect.Effect<string, Error> =>
    Effect.succeed(VERSION),
): Parameters<typeof updateGitHubSourcePin>[0] {
  return {
    args,
    latestVersion,
    pinFilePath,
    repositoryRootPath: ROOT,
    runner,
    source: {
      owner: "example",
      repo: "tool",
      tag: (version: string): string => `v${version}`,
    },
  } as const;
}

function update(
  pinFilePath: string,
  runner: Readonly<FakeCommandRunner>,
): ReturnType<typeof updateGitHubSourcePin> {
  const updateOptions = options(pinFilePath, runner);
  return updateGitHubSourcePin(updateOptions);
}

Deno.test("GitHub source pin update writes example source hash", async (): Promise<void> => {
  const directory = await Deno.makeTempDir();
  const pinFilePath = `${directory}/pin.json`;
  const runner = new FakeCommandRunner([
    {
      assertRequest(request): void {
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
        assertStringIncludes(expression, `path:${ROOT}`);
      },
      result: { code: 1, stderr: `error: got: ${SOURCE_HASH}`, stdout: "" },
    },
  ]);
  try {
    await Effect.runPromise(update(pinFilePath, runner));
    assertEquals(
      await Deno.readTextFile(pinFilePath),
      `{\n  "version": "${VERSION}",\n  "sourceHash": "${SOURCE_HASH}"\n}\n`,
    );
    runner.assertExhausted();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("GitHub source pin update preserves pin and latest-version error identity", async (): Promise<void> => {
  const directory = await Deno.makeTempDir();
  const pinFilePath = `${directory}/pin.json`;
  await Deno.writeFile(pinFilePath, PIN_SENTINEL);
  const runner = new FakeCommandRunner([]);
  const error = new Error("latest version unavailable");
  try {
    const updateEffect = updateGitHubSourcePin(
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
