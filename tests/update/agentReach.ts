import { assertEquals, assertStringIncludes } from "@jsr/std__assert";
import type { CommandRequest } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import { FakeCommandRunner } from "coolheadedTestSupport/commandRunner.ts";
import { strictJsonClient } from "coolheadedTestSupport/httpClient.ts";
import { updateProgram } from "coolheadedPackageAgentReach";

const VERSION = "1.2.3";
const SOURCE_HASH = "sha256-SOURCE";

Deno.test("Agent Reach updater writes a tag-based source pin", async (): Promise<void> => {
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
        const expression = request.command.at(5);
        if (expression === undefined) {
          throw new TypeError("source prefetch requires an expression");
        }
        assertStringIncludes(expression, 'owner = "Panniantong"');
        assertStringIncludes(expression, 'repo = "Agent-Reach"');
        assertStringIncludes(expression, `tag = "v${VERSION}"`);
        assertEquals(request.cwd, directory);
      },
      result: { code: 1, stderr: `error: got: ${SOURCE_HASH}`, stdout: "" },
    },
  ]);
  const json = strictJsonClient([]);
  try {
    await Effect.runPromise(
      updateProgram([VERSION], {
        jsonClient: json.client,
        pinFilePath,
        repositoryRootPath: directory,
        runner,
      }),
    );
    assertEquals(
      await Deno.readTextFile(pinFilePath),
      `{\n  "version": "${VERSION}",\n  "sourceHash": "${SOURCE_HASH}"\n}\n`,
    );
    runner.assertExhausted();
    json.assertExhausted();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
