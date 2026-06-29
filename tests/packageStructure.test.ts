import { describe, it } from "@jsr/std__testing/bdd";
import { assertEquals } from "@jsr/std__assert";
import { join } from "@jsr/std__path";
import { serializePinJson } from "coolheaded/pinJson.ts";

type PinJsonConfig = Parameters<typeof serializePinJson>[0];

const PACKAGES_DIRECTORY_PATH = new globalThis.URL("../packages/", import.meta.url).pathname;
const PACKAGE_DIRECTORY_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9][A-Za-z0-9]*)*$/u;
const ALLOWED_PACKAGE_FILES = new Set([
  "checks.nix",
  "generatedPackage.nix",
  "package.nix",
  "package-lock.json",
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry: unknown): boolean => typeof entry === "string")
  );
}

function isPinJsonConfig(value: unknown): value is PinJsonConfig {
  if (!isRecord(value) || typeof value["version"] !== "string") {
    return false;
  }

  return (
    isOptionalString(value["binaryVersion"]) &&
    isOptionalString(value["cargoVendorHash"]) &&
    isOptionalString(value["npmVendorHash"]) &&
    isOptionalString(value["packageHash"]) &&
    isOptionalString(value["sourceHash"]) &&
    (value["platformPackageHashes"] === undefined || isStringRecord(value["platformPackageHashes"]))
  );
}

function pinJsonHasCanonicalOrder(contents: string): boolean {
  const pin: unknown = JSON.parse(contents);
  return isPinJsonConfig(pin) ? contents === serializePinJson(pin) : false;
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
