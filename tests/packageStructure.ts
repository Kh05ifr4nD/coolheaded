import { assertEquals, assertRejects } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import { checkFileSpec } from "coolheaded/repo/fileSpec/check.ts";
import { checkedFileSpec } from "coolheaded/repo/fileSpec.ts";
import { join } from "@jsr/std__path";
import { serializePinJson } from "coolheaded/pin/json.ts";

type PinJsonConfig = Parameters<typeof serializePinJson>[0];

const PACKAGES_DIRECTORY_PATH = new globalThis.URL("../packages/", import.meta.url).pathname;
const REPOSITORY_ROOT_PATH = new globalThis.URL("../", import.meta.url).pathname;

async function packageDirectories(): Promise<readonly string[]> {
  const entries = await Array.fromAsync(Deno.readDir(PACKAGES_DIRECTORY_PATH));

  return entries
    .filter((entry: Readonly<Deno.DirEntry>): boolean => entry.isDirectory)
    .map((entry: Readonly<Deno.DirEntry>): string => entry.name)
    .toSorted();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch (error: unknown) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }

    throw error;
  }
}

async function runGit(repositoryRoot: string, args: readonly string[]): Promise<void> {
  const output = await new Deno.Command("git", {
    args: [...args],
    clearEnv: true,
    cwd: repositoryRoot,
    env: { PATH: Deno.env.get("PATH") ?? "" },
    stderr: "piped",
    stdout: "piped",
  }).output();

  if (!output.success) {
    const stderr = new globalThis.TextDecoder().decode(output.stderr).trim();
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

async function withTemporaryDirectory<Success>(
  useDirectory: (directoryPath: string) => Promise<Success>,
): Promise<Success> {
  const directoryPath = await Deno.makeTempDir({
    prefix: "coolheaded-file-spec-test-",
  });

  try {
    return await useDirectory(directoryPath);
  } finally {
    await Deno.remove(directoryPath, { recursive: true });
  }
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
  if (!(await fileExists(pinPath))) {
    return undefined;
  }

  const contents = await Deno.readTextFile(pinPath);
  return pinJsonHasCanonicalOrder(contents) ? undefined : `${name}/pin.json`;
}

describe("package structure", (): void => {
  it("keeps git ls-files fully conformant to fileSpec.cue", async (): Promise<void> => {
    await checkedFileSpec();
  });

  it("isolates fileSpec subprocesses from loader environment variables", async (): Promise<void> => {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-env=PATH",
        "--allow-read",
        "--allow-run=cue,git",
        "--allow-write",
        "lib/ts/repo/fileSpec.ts",
      ],
      clearEnv: true,
      cwd: REPOSITORY_ROOT_PATH,
      env: {
        LD_DYLD_PATH: "/tmp/coolheaded-file-spec-loader-path",
        PATH: Deno.env.get("PATH") ?? "",
      },
      stderr: "piped",
      stdout: "piped",
    });

    const output = await command.output();

    assertEquals(output.success, true, new globalThis.TextDecoder().decode(output.stderr).trim());
  });

  it("rejects ignored directories hiding fileSpec-admitted files", async (): Promise<void> => {
    await withTemporaryDirectory(async (repositoryRoot: string): Promise<void> => {
      await runGit(repositoryRoot, ["init"]);
      await Deno.mkdir(join(repositoryRoot, "hidden"));
      await Deno.writeTextFile(join(repositoryRoot, ".gitignore"), "hidden/\n");
      await Deno.writeTextFile(
        join(repositoryRoot, "fileSpec.cue"),
        `package fileSpec

#RegularFile: true

#FileSpec: {
\t".gitignore"!:   #RegularFile
\t"fileSpec.cue"!: #RegularFile
\thidden?: {
\t\t"allowed.ts"?: #RegularFile
\t}
}
`,
      );
      await Deno.writeTextFile(join(repositoryRoot, "hidden/allowed.ts"), "export {};\n");
      await runGit(repositoryRoot, ["add", ".gitignore", "fileSpec.cue"]);

      await assertRejects(
        (): Promise<void> => checkFileSpec(repositoryRoot),
        Error,
        "hidden/allowed.ts",
      );
    });
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
