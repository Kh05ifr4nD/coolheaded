import {
  REPOSITORY_ROOT_PATH,
  requiredToolPath,
  runGit,
  withTemporaryDirectory,
  writeRepositoryFixture,
} from "./fixture.ts";
import { assertEquals, assertRejects, assertThrows } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import { checkLayout } from "coolheaded/repo/layout/check.ts";
import { join } from "@jsr/std__path";
import { layout } from "coolheaded/repo/layout/model.ts";

async function layoutPathConforms(paths: readonly string[]): Promise<boolean> {
  return await withTemporaryDirectory(async (directoryPath: string): Promise<boolean> => {
    const candidatePath = join(directoryPath, "layout.json");
    await Deno.writeTextFile(candidatePath, `${JSON.stringify(layout(paths), null, 2)}\n`);
    const output = await new Deno.Command(requiredToolPath("COOLHEADED_CUE"), {
      args: ["vet", join(REPOSITORY_ROOT_PATH, "layout.cue"), candidatePath, "-d", "#LayoutPath"],
      clearEnv: true,
      cwd: REPOSITORY_ROOT_PATH,
      env: { PATH: Deno.env.get("PATH") ?? "" },
      stderr: "piped",
      stdout: "piped",
    }).output();
    return output.success;
  });
}

describe("tree conformance boundaries", (): void => {
  it("uses generic source layout rules instead of a file manifest", async (): Promise<void> => {
    assertEquals(await layoutPathConforms(["lib/ts/repo/newModule.ts"]), true);
    assertEquals(await layoutPathConforms(["lib/ts/repo/new_module.ts"]), false);
    assertEquals(await layoutPathConforms([".vscode/settings.json"]), false);
  });

  it("uses one recursive directory shape for every repository directory", async (): Promise<void> => {
    assertEquals(await layoutPathConforms(["flake/newGuide.md"]), true);
    assertEquals(await layoutPathConforms(["homeModules/newGuide.md"]), true);
    assertEquals(await layoutPathConforms(["lib/newArea/newGuide.md"]), true);
    assertEquals(await layoutPathConforms(["tests/newGuide.md"]), true);
  });

  it("rejects invalid and conflicting git paths", (): void => {
    assertThrows((): void => void layout([""]), Error, "Invalid git path");
    assertThrows(
      (): void => void layout(["tree/leaf.ts", "tree"]),
      Error,
      "Git path conflicts with directory",
    );
    assertThrows(
      (): void => void layout(["leaf.ts", "leaf.ts/child"]),
      Error,
      "Git path conflicts with file",
    );
  });

  it("validates tracked paths regardless of ignore rules", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await writeRepositoryFixture(repositoryRoot, {
        files: [{ contents: "export {};\n", path: "tracked.ts" }],
        gitignore: "tracked.ts\n",
        pathFields: '\t"tracked.ts"?: #RegularFile',
        requiredFields: '\t"tracked.ts"!: #RegularFile',
      });
      await runGit(repositoryRoot, ["add", "-f", "tracked.ts"]);

      await checkLayout(repositoryRoot);
    });
  });

  it("rejects an extra visible file", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await writeRepositoryFixture(repositoryRoot, {
        files: [{ contents: "export {};\n", path: "extra.ts" }],
      });

      await assertRejects((): Promise<void> => checkLayout(repositoryRoot), Error, "extra.ts");
    });
  });

  it("rejects a missing required file", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await writeRepositoryFixture(repositoryRoot, {
        pathFields: '\t"required.ts"?: #RegularFile',
        requiredFields: '\t"required.ts"!: #RegularFile',
      });

      await assertRejects((): Promise<void> => checkLayout(repositoryRoot), Error, "required.ts");
    });
  });
});
