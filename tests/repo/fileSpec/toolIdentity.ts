import { EXECUTABLE_MODE, withTemporaryDirectory, writeRepositoryFixture } from "./fixture.ts";
import { actualToolEnvironment, runSnapshotProbe } from "./snapshotFixture.ts";
import { describe, it } from "@jsr/std__testing/bdd";
import type { FileSpecCommand } from "coolheaded/repo/fileSpec/model.ts";
import { assertEquals } from "@jsr/std__assert";
import { changedSnapshotComponents } from "coolheaded/repo/fileSpec/check.ts";
import { join } from "@jsr/std__path";

type WrapperFixture = Readonly<{
  readonly firstPath: string;
  readonly secondPath: string;
  readonly statePath: string;
}>;

async function writeWrapperFixture(
  repositoryRoot: string,
  command: FileSpecCommand,
): Promise<WrapperFixture> {
  const tools = actualToolEnvironment();
  const statePath = join(repositoryRoot, `${command}-version`);
  const firstPath = join(repositoryRoot, `${command}-first`);
  const secondPath = join(repositoryRoot, `${command}-second`);
  const versionArgument = command === "cue" ? "version" : "--version";
  const contents = `#!/bin/sh
if [ "$1" = ${JSON.stringify(versionArgument)} ]; then cat ${JSON.stringify(statePath)}; exit 0; fi
exec ${JSON.stringify(tools[command])} "$@"
`;
  await Deno.writeTextFile(statePath, "stable-version\n");
  await Deno.writeTextFile(firstPath, contents);
  await Deno.writeTextFile(secondPath, contents);
  await Deno.chmod(firstPath, EXECUTABLE_MODE);
  await Deno.chmod(secondPath, EXECUTABLE_MODE);
  return { firstPath, secondPath, statePath };
}

describe("Git and CUE tool identity", (): void => {
  for (const command of ["cue", "git"] as const) {
    it(`isolates ${command} executable, version, and digest changes`, async (): Promise<void> => {
      await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
        await writeRepositoryFixture(repositoryRoot, {
          gitignore: `${command}-first\n${command}-second\n${command}-version\n`,
        });
        const wrapper = await writeWrapperFixture(repositoryRoot, command);
        const actualTools = actualToolEnvironment();
        const firstTools = { ...actualTools, [command]: wrapper.firstPath };
        const first = await runSnapshotProbe(repositoryRoot, firstTools);
        const pathChanged = await runSnapshotProbe(repositoryRoot, {
          ...actualTools,
          [command]: wrapper.secondPath,
        });
        assertEquals(changedSnapshotComponents(first, pathChanged), [
          `tools.${command}.executable`,
        ]);

        await Deno.writeTextFile(wrapper.statePath, "changed-version\n");
        const versionChanged = await runSnapshotProbe(repositoryRoot, firstTools);
        assertEquals(changedSnapshotComponents(first, versionChanged), [
          `tools.${command}.version`,
        ]);

        await Deno.writeTextFile(wrapper.statePath, "stable-version\n");
        await Deno.writeTextFile(wrapper.firstPath, "\n", { append: true });
        const digestChanged = await runSnapshotProbe(repositoryRoot, firstTools);
        assertEquals(changedSnapshotComponents(first, digestChanged), [`tools.${command}.sha256`]);
      });
    });
  }
});
