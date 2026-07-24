import type { CommandRunner } from "coolheaded/core/commandRunner.ts";

const DENO_SNAPSHOT_HASH_FILE_PATH = "flake/denoDependencies.nix";
const FAKE_HASH = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

interface DenoSnapshotBuildResult {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}

function denoSnapshotHashPattern(): RegExp {
  return /(?<prefix>hash = ")sha256-[A-Za-z0-9+/=]+(?<suffix>";)/u;
}

function denoSnapshotHash(content: string): string {
  const match = denoSnapshotHashPattern().exec(content);
  if (match?.[0] === undefined) {
    throw new Error("Missing Deno snapshot hash");
  }

  const hashMatch = /sha256-[A-Za-z0-9+/=]+/u.exec(match[0]);
  if (hashMatch?.[0] === undefined) {
    throw new Error("Malformed Deno snapshot hash");
  }

  return hashMatch[0];
}

function replaceDenoSnapshotHash(content: string, hash: string): string {
  const pattern = denoSnapshotHashPattern();
  if (!pattern.test(content)) {
    throw new Error("Missing Deno snapshot hash");
  }

  return content.replace(pattern, `$<prefix>${hash}$<suffix>`);
}

function denoSnapshotBuildCommand(system: string): readonly string[] {
  return ["nix", "build", `.#checks.${system}.denoDependencies`, "--no-link", "--print-build-logs"];
}

function parsedNixHash(output: string): string {
  const match = /got:\s+(?<hash>sha256-[A-Za-z0-9+/=]+)/u.exec(output);
  if (match?.groups?.["hash"] === undefined) {
    throw new Error(`Unable to parse Nix fixed-output hash from output:\n${output}`);
  }

  return match.groups["hash"];
}

function isDenoSnapshotHashMismatch(output: string): boolean {
  return (
    output.includes("coolheaded-deno-dependencies") && /got:\s+sha256-[A-Za-z0-9+/=]+/u.test(output)
  );
}

async function buildDenoSnapshotCheck(
  system: string,
  runner: CommandRunner,
): Promise<DenoSnapshotBuildResult> {
  const [command, ...args] = denoSnapshotBuildCommand(system);
  if (command === undefined) {
    throw new Error("Missing Deno snapshot build command");
  }

  const output = await runner.run({ command: [command, ...args] });

  return {
    code: output.code,
    stderr: output.stderr.trim(),
    stdout: output.stdout.trim(),
  };
}

async function buildDenoSnapshotHash(system: string, runner: CommandRunner): Promise<string> {
  const result = await buildDenoSnapshotCheck(system, runner);
  if (result.code === 0) {
    throw new Error("Expected fake Deno snapshot hash to fail, but the build succeeded");
  }

  return parsedNixHash(`${result.stdout}\n${result.stderr}`);
}

async function buildDenoSnapshotHashWithFakeHash(
  system: string,
  original: string,
  fake: string,
  runner: CommandRunner,
  filePath: string,
): Promise<string> {
  await Deno.writeTextFile(filePath, fake);
  try {
    return await buildDenoSnapshotHash(system, runner);
  } finally {
    await Deno.writeTextFile(filePath, original);
  }
}

async function updateDenoSnapshotHash(
  system: string,
  runner: CommandRunner,
  filePath = DENO_SNAPSHOT_HASH_FILE_PATH,
): Promise<void> {
  const original = await Deno.readTextFile(filePath);
  const fake = replaceDenoSnapshotHash(original, FAKE_HASH);
  const hash = await buildDenoSnapshotHashWithFakeHash(system, original, fake, runner, filePath);

  await Deno.writeTextFile(filePath, replaceDenoSnapshotHash(original, hash));
}

export {
  buildDenoSnapshotCheck,
  DENO_SNAPSHOT_HASH_FILE_PATH,
  denoSnapshotBuildCommand,
  denoSnapshotHash,
  isDenoSnapshotHashMismatch,
  parsedNixHash,
  replaceDenoSnapshotHash,
  updateDenoSnapshotHash,
};
export type { DenoSnapshotBuildResult };
