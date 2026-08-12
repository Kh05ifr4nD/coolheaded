import {
  EXECUTABLE_MODE,
  runGit,
  runGitBytes,
  withTemporaryDirectory,
  writeRepositoryFixture,
} from "./fixture.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import { checkLayout } from "coolheaded/repo/layout/check.ts";
import { gitIndexEntriesFrom } from "coolheaded/repo/layout/git.ts";
import { isLayoutError } from "coolheaded/repo/layout/model.ts";

const INVALID_UTF8_BYTE = 255;

describe("Git index hardening", (): void => {
  it("rejects symlinks while accepting executables", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await writeRepositoryFixture(repositoryRoot, {
        files: [{ contents: "#!/bin/sh\n", path: "executable" }],
        pathFields: "\texecutable?: #RegularFile\n\tlink?: #RegularFile",
        requiredFields: "\texecutable?: #RegularFile\n\tlink?: #RegularFile",
      });
      await Deno.chmod(`${repositoryRoot}/executable`, EXECUTABLE_MODE);
      await runGit(repositoryRoot, ["add", "executable"]);
      await checkLayout(repositoryRoot);
      const blobOutput = await runGit(repositoryRoot, ["hash-object", "-w", "--stdin"], "target");
      const blob = blobOutput.trim();

      await runGit(repositoryRoot, ["update-index", "--add", "--cacheinfo", `120000,${blob},link`]);
      await assertRejects((): Promise<void> => checkLayout(repositoryRoot), Error, "kind symlink");
    });
  });

  it("rejects a gitlink backed by a commit object", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await writeRepositoryFixture(repositoryRoot, {
        files: [{ contents: "value\n", path: "tracked" }],
        pathFields: "\tgitlink?: #RegularFile\n\ttracked?: #RegularFile",
        requiredFields: "\tgitlink?: #RegularFile\n\ttracked?: #RegularFile",
      });
      await runGit(repositoryRoot, ["config", "user.email", "tests@example.invalid"]);
      await runGit(repositoryRoot, ["config", "user.name", "Layout Tests"]);
      await runGit(repositoryRoot, ["add", "tracked"]);
      await runGit(repositoryRoot, ["commit", "-m", "fixture"]);
      const commitOutput = await runGit(repositoryRoot, ["rev-parse", "HEAD"]);
      const commit = commitOutput.trim();
      await runGit(repositoryRoot, [
        "update-index",
        "--add",
        "--cacheinfo",
        `160000,${commit},gitlink`,
      ]);

      await assertRejects((): Promise<void> => checkLayout(repositoryRoot), Error, "kind gitlink");
    });
  });

  it("rejects unresolved index stages", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await writeRepositoryFixture(repositoryRoot, {
        pathFields: "\tconflict?: #RegularFile",
        requiredFields: "\tconflict?: #RegularFile",
      });
      const firstOutput = await runGit(repositoryRoot, ["hash-object", "-w", "--stdin"], "first");
      const secondOutput = await runGit(repositoryRoot, ["hash-object", "-w", "--stdin"], "second");
      const first = firstOutput.trim();
      const second = secondOutput.trim();
      await runGit(
        repositoryRoot,
        ["update-index", "--index-info"],
        `100644 ${first} 1\tconflict\n100644 ${second} 2\tconflict\n`,
      );

      await assertRejects(
        (): Promise<void> => checkLayout(repositoryRoot),
        Error,
        "unresolved stage",
      );
    });
  });

  it("classifies invalid UTF-8 pathnames as input decode failures", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await writeRepositoryFixture(repositoryRoot);
      const objectOutput = await runGit(repositoryRoot, ["hash-object", "-w", "--stdin"], "value");
      const object = objectOutput.trim();
      const prefix = new globalThis.TextEncoder().encode(`100644 ${object}\t`);
      await runGitBytes(
        repositoryRoot,
        ["update-index", "-z", "--index-info"],
        [...prefix, INVALID_UTF8_BYTE, 0],
      );

      const error = await assertRejects((): Promise<readonly unknown[]> =>
        gitIndexEntriesFrom(repositoryRoot),
      );
      assertInstanceOf(error, Error);
      assertEquals(isLayoutError(error), true);
      if (!isLayoutError(error) || error.kind !== "inputDecode") {
        throw new Error("expected InputDecodeError");
      }
      assertEquals(error.name, "InputDecodeError");
      assertEquals(error.source, "git stdout");
    });
  });
});
