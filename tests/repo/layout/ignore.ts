import { assertEquals, assertInstanceOf, assertRejects } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import { runGit, withTemporaryDirectory, writeRepositoryFixture } from "./fixture.ts";
import { checkLayout } from "coolheaded/repo/layout/check.ts";

describe("Git ignore boundary", (): void => {
  it("ignores local garbage without making it part of layout validation", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await writeRepositoryFixture(repositoryRoot, {
        files: [{ contents: "temporary\n", path: "hidden/garbage.ts" }],
        gitignore: "hidden/\n",
      });

      await checkLayout(repositoryRoot);
    });
  });

  it("lets CUE reject an ignored path that is force-added to the index", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await writeRepositoryFixture(repositoryRoot, {
        files: [{ contents: "temporary\n", path: "hidden/garbage.ts" }],
        gitignore: "hidden/\n",
      });
      await runGit(repositoryRoot, ["add", "-f", "hidden/garbage.ts"]);

      const error = await assertRejects((): Promise<void> => checkLayout(repositoryRoot));
      assertInstanceOf(error, Error);
      assertEquals(error.message.includes("does not conform to layout.cue"), true);
      assertEquals(error.message.includes("paths ignored"), false);
    });
  });
});
