import { assertRejects, assertThrows } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import { runGit, withTemporaryDirectory, writeRepositoryFixture } from "./fixture.ts";
import { checkFileSpec } from "coolheaded/repo/fileSpec/check.ts";
import { fileSpec } from "coolheaded/repo/fileSpec/model.ts";

describe("tree conformance boundaries", (): void => {
  it("rejects invalid and conflicting git paths", (): void => {
    assertThrows((): void => void fileSpec([""]), Error, "Invalid git path");
    assertThrows(
      (): void => void fileSpec(["tree/leaf.ts", "tree"]),
      Error,
      "Git path conflicts with directory",
    );
    assertThrows(
      (): void => void fileSpec(["leaf.ts", "leaf.ts/child"]),
      Error,
      "Git path conflicts with file",
    );
  });

  it("rejects tracked paths hidden by ignore rules", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await writeRepositoryFixture(repositoryRoot, {
        files: [{ contents: "export {};\n", path: "tracked.ts" }],
        gitignore: "tracked.ts\n",
        pathFields: '\t"tracked.ts"?: #RegularFile',
        requiredFields: '\t"tracked.ts"!: #RegularFile',
      });
      await runGit(repositoryRoot, ["add", "-f", "tracked.ts"]);

      await assertRejects((): Promise<void> => checkFileSpec(repositoryRoot), Error, "tracked.ts");
    });
  });

  it("rejects an extra visible file", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await writeRepositoryFixture(repositoryRoot, {
        files: [{ contents: "export {};\n", path: "extra.ts" }],
      });

      await assertRejects((): Promise<void> => checkFileSpec(repositoryRoot), Error, "extra.ts");
    });
  });

  it("rejects a missing required file", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await writeRepositoryFixture(repositoryRoot, {
        pathFields: '\t"required.ts"?: #RegularFile',
        requiredFields: '\t"required.ts"!: #RegularFile',
      });

      await assertRejects((): Promise<void> => checkFileSpec(repositoryRoot), Error, "required.ts");
    });
  });
});
