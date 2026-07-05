import {
  CUE_SCHEMA_NAME,
  FILE_SPEC_SCHEMA_FILE_NAME,
  fileSpec,
  fileSpecError,
  isFileSpecError,
} from "coolheaded/repo/fileSpec/model.ts";
import {
  commandOutput,
  gitPathsFrom,
  ignoredFilePaths,
  ignoredIndexPathDetails,
  repositoryRoot,
} from "coolheaded/repo/fileSpec/git.ts";

async function validateIndexPathsNotIgnored(
  repositoryRootPath: string,
  paths: readonly string[],
): Promise<void> {
  const ignoredPaths = await ignoredIndexPathDetails(repositoryRootPath, paths);

  if (ignoredPaths.length === 0) {
    return;
  }

  throw fileSpecError(
    [
      "git index contains paths ignored by current ignore rules:",
      ...ignoredPaths.map((path: string): string => `- ${path}`),
    ].join("\n"),
  );
}

async function withTemporaryDirectory<Success>(
  useDirectory: (directoryPath: string) => Promise<Success>,
): Promise<Success> {
  const directoryPath = await Deno.makeTempDir({
    prefix: "coolheaded-file-spec-",
  });

  try {
    return await useDirectory(directoryPath);
  } finally {
    await Deno.remove(directoryPath, { recursive: true });
  }
}

async function validateFileSpec(
  repositoryRootPath: string,
  spec: ReturnType<typeof fileSpec>,
  label: string,
): Promise<void> {
  await withTemporaryDirectory(async (directoryPath: string): Promise<void> => {
    const schemaPath = `${repositoryRootPath}/${FILE_SPEC_SCHEMA_FILE_NAME}`;
    const specPath = `${directoryPath}/fileSpec.json`;
    const cueArguments = ["vet", schemaPath, specPath, "-d", CUE_SCHEMA_NAME];

    await Deno.writeTextFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    try {
      await commandOutput("cue", cueArguments, repositoryRootPath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw fileSpecError(`${label} does not conform to ${FILE_SPEC_SCHEMA_FILE_NAME}: ${message}`);
    }
  });
}

async function validateGitPaths(
  repositoryRootPath: string,
  label: string,
  paths: readonly string[],
): Promise<void> {
  await validateFileSpec(repositoryRootPath, fileSpec(paths), label);
}

async function fileSpecConforms(
  repositoryRootPath: string,
  paths: readonly string[],
): Promise<boolean> {
  try {
    await validateFileSpec(repositoryRootPath, fileSpec(paths), "candidate git paths");
    return true;
  } catch (error: unknown) {
    if (isFileSpecError(error)) {
      return false;
    }

    throw error;
  }
}

async function validateIgnoredPathsNotAdmittedByFileSpec(
  repositoryRootPath: string,
  indexPaths: readonly string[],
): Promise<void> {
  const ignoredPaths = await ignoredFilePaths(repositoryRootPath);
  const admittedIgnoredPathResults = await Promise.all(
    ignoredPaths.map(async (ignoredPath: string): Promise<string | undefined> => {
      const candidatePaths = [...indexPaths, ignoredPath].toSorted();
      const conforms = await fileSpecConforms(repositoryRootPath, candidatePaths);

      return conforms ? ignoredPath : undefined;
    }),
  );
  const admittedIgnoredPaths = admittedIgnoredPathResults.filter(
    (path: string | undefined): path is string => typeof path === "string",
  );

  if (admittedIgnoredPaths.length === 0) {
    return;
  }

  throw fileSpecError(
    [
      "current ignore rules hide paths admitted by fileSpec.cue:",
      ...admittedIgnoredPaths.map((path: string): string => `- ${path}`),
    ].join("\n"),
  );
}

async function checkFileSpec(repositoryRootPath: string): Promise<void> {
  const indexPaths = await gitPathsFrom(repositoryRootPath, ["--cached"]);
  const visiblePaths = await gitPathsFrom(repositoryRootPath, [
    "--cached",
    "--others",
    "--exclude-standard",
  ]);

  await validateGitPaths(repositoryRootPath, "git index", indexPaths);
  await validateIndexPathsNotIgnored(repositoryRootPath, indexPaths);
  await validateGitPaths(repositoryRootPath, "git visible files", visiblePaths);
  await validateIgnoredPathsNotAdmittedByFileSpec(repositoryRootPath, indexPaths);
}

async function checkedFileSpec(): Promise<void> {
  await checkFileSpec(await repositoryRoot());
}

export { checkedFileSpec, checkFileSpec };
