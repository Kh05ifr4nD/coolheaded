import { describe, it } from "@jsr/std__testing/bdd";
import { assertEquals } from "@jsr/std__assert";
import { join } from "@jsr/std__path";

const PACKAGES_DIRECTORY_PATH = new globalThis.URL("../packages/", import.meta.url).pathname;
const PACKAGE_DIRECTORY_PATTERN = /^[a-z][A-Za-z0-9]*$/u;
const ALLOWED_PACKAGE_FILES = new Set([
  "generatedPackage.nix",
  "package.nix",
  "pin.json",
  "update.ts",
  "uv.lock",
]);
const REQUIRED_PACKAGE_FILES = ["package.nix", "update.ts"] as const;

interface PackageStructureProblems {
  readonly invalidPackageNames: readonly string[];
  readonly missingRequiredFiles: readonly string[];
  readonly unexpectedEntries: readonly string[];
}

async function packageDirectories(): Promise<readonly string[]> {
  const entries = await Array.fromAsync(Deno.readDir(PACKAGES_DIRECTORY_PATH));

  return entries
    .filter((entry: Readonly<Deno.DirEntry>): boolean => entry.isDirectory)
    .map((entry: Readonly<Deno.DirEntry>): string => entry.name)
    .toSorted();
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error: unknown) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }

    throw error;
  }
}

async function missingRequiredFiles(name: string): Promise<readonly string[]> {
  const missing = await Promise.all(
    REQUIRED_PACKAGE_FILES.map(async (fileName: string): Promise<string | undefined> => {
      const path = join(PACKAGES_DIRECTORY_PATH, name, fileName);
      return (await exists(path)) ? undefined : `${name}/${fileName}`;
    }),
  );

  return missing.filter(
    (fileName: string | undefined): fileName is string => fileName !== undefined,
  );
}

async function unexpectedPatchEntries(name: string): Promise<readonly string[]> {
  const patchDirectoryPath = join(PACKAGES_DIRECTORY_PATH, name, "patch");
  const entries = await Array.fromAsync(Deno.readDir(patchDirectoryPath));

  return entries
    .filter(
      (entry: Readonly<Deno.DirEntry>): boolean => !entry.isFile || !entry.name.endsWith(".patch"),
    )
    .map((entry: Readonly<Deno.DirEntry>): string => `${name}/patch/${entry.name}`);
}

async function unexpectedPackageEntries(name: string): Promise<readonly string[]> {
  const directoryPath = join(PACKAGES_DIRECTORY_PATH, name);
  const entries = await Array.fromAsync(Deno.readDir(directoryPath));
  const unexpectedTopLevelEntries = entries
    .filter((entry: Readonly<Deno.DirEntry>): boolean =>
      entry.isFile ? !ALLOWED_PACKAGE_FILES.has(entry.name) : entry.name !== "patch",
    )
    .map((entry: Readonly<Deno.DirEntry>): string =>
      entry.isDirectory ? `${name}/${entry.name}/` : `${name}/${entry.name}`,
    );
  const patchEntries = entries.some(
    (entry: Readonly<Deno.DirEntry>): boolean => entry.isDirectory && entry.name === "patch",
  )
    ? await unexpectedPatchEntries(name)
    : [];

  return [...unexpectedTopLevelEntries, ...patchEntries];
}

async function packageStructureProblems(name: string): Promise<PackageStructureProblems> {
  return {
    invalidPackageNames: PACKAGE_DIRECTORY_PATTERN.test(name) ? [] : [name],
    missingRequiredFiles: await missingRequiredFiles(name),
    unexpectedEntries: await unexpectedPackageEntries(name),
  };
}

function pinJsonHasCanonicalOrder(contents: string): boolean {
  if (!contents.startsWith('{\n  "version":')) {
    return false;
  }

  const lines = contents.split("\n");
  const binaryVersionIndex = lines.findIndex((line: string): boolean =>
    line.startsWith('  "binaryVersion": "'),
  );
  const hashesIndex = lines.indexOf('  "hashes": {');
  if (hashesIndex === -1) {
    return true;
  }
  if (binaryVersionIndex !== -1 && binaryVersionIndex !== hashesIndex - 1) {
    return false;
  }

  return (
    lines[hashesIndex + 1]?.startsWith('    "aarch64-darwin": "') === true &&
    lines[hashesIndex + 2]?.startsWith('    "aarch64-linux": "') === true &&
    lines[hashesIndex + 3]?.startsWith('    "x86_64-linux": "') === true
  );
}

async function invalidPinOrder(name: string): Promise<string | undefined> {
  const pinPath = join(PACKAGES_DIRECTORY_PATH, name, "pin.json");
  if (!(await exists(pinPath))) {
    return undefined;
  }

  const contents = await Deno.readTextFile(pinPath);
  return pinJsonHasCanonicalOrder(contents) ? undefined : `${name}/pin.json`;
}

describe("package structure", (): void => {
  it("matches the declared package directory contract", async (): Promise<void> => {
    const directoryNames = await packageDirectories();
    const problems = await Promise.all(
      directoryNames.map(
        (name: string): Promise<PackageStructureProblems> => packageStructureProblems(name),
      ),
    );

    assertEquals(
      problems.flatMap((problem) => problem.invalidPackageNames),
      [],
    );
    assertEquals(
      problems.flatMap((problem) => problem.missingRequiredFiles),
      [],
    );
    assertEquals(
      problems.flatMap((problem) => problem.unexpectedEntries),
      [],
    );
  });

  it("keeps pin.json fields in canonical order", async (): Promise<void> => {
    const directoryNames = await packageDirectories();
    const invalidPins = await Promise.all(
      directoryNames.map((name: string): Promise<string | undefined> => invalidPinOrder(name)),
    );

    assertEquals(
      invalidPins.filter((pin): pin is string => pin !== undefined),
      [],
    );
  });
});
