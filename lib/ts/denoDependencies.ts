const DENO_DEPENDENCY_HASH_FILE_PATH = "flake/denoDependencies.nix";
const FAKE_HASH = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

interface DenoDependencyBuildResult {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}

function denoDependencyHashPattern(): RegExp {
  return /(?<prefix>hash = ")sha256-[A-Za-z0-9+/=]+(?<suffix>";)/u;
}

function denoDependencyHash(content: string): string {
  const match = denoDependencyHashPattern().exec(content);
  if (match?.[0] === undefined) {
    throw new Error("Missing Deno dependency hash");
  }

  const hashMatch = /sha256-[A-Za-z0-9+/=]+/u.exec(match[0]);
  if (hashMatch?.[0] === undefined) {
    throw new Error("Malformed Deno dependency hash");
  }

  return hashMatch[0];
}

function replaceDenoDependencyHash(content: string, hash: string): string {
  const pattern = denoDependencyHashPattern();
  if (!pattern.test(content)) {
    throw new Error("Missing Deno dependency hash");
  }

  return content.replace(pattern, `$<prefix>${hash}$<suffix>`);
}

function denoDependencyBuildCommand(system: string): readonly string[] {
  return ["nix", "build", `.#checks.${system}.denoDependencies`, "--no-link", "--print-build-logs"];
}

function parsedNixHash(output: string): string {
  const match = /got:\s+(?<hash>sha256-[A-Za-z0-9+/=]+)/u.exec(output);
  if (match?.groups?.["hash"] === undefined) {
    throw new Error(`Unable to parse Nix fixed-output hash from output:\n${output}`);
  }

  return match.groups["hash"];
}

function isDenoDependencyHashMismatch(output: string): boolean {
  return (
    output.includes("coolheaded-deno-dependencies") && /got:\s+sha256-[A-Za-z0-9+/=]+/u.test(output)
  );
}

async function buildDenoDependencyCheck(system: string): Promise<DenoDependencyBuildResult> {
  const [command, ...args] = denoDependencyBuildCommand(system);
  if (command === undefined) {
    throw new Error("Missing Deno dependency build command");
  }

  const output = await new Deno.Command(command, {
    args,
    stderr: "piped",
    stdout: "piped",
  }).output();

  return {
    code: output.code,
    stderr: new globalThis.TextDecoder().decode(output.stderr).trim(),
    stdout: new globalThis.TextDecoder().decode(output.stdout).trim(),
  };
}

async function buildDenoDependencyHash(system: string): Promise<string> {
  const result = await buildDenoDependencyCheck(system);
  if (result.code === 0) {
    throw new Error("Expected fake Deno dependency hash to fail, but the build succeeded");
  }

  return parsedNixHash(`${result.stdout}\n${result.stderr}`);
}

async function buildDenoDependencyHashWithFakeHash(
  system: string,
  original: string,
  fake: string,
): Promise<string> {
  await Deno.writeTextFile(DENO_DEPENDENCY_HASH_FILE_PATH, fake);
  try {
    return await buildDenoDependencyHash(system);
  } finally {
    await Deno.writeTextFile(DENO_DEPENDENCY_HASH_FILE_PATH, original);
  }
}

async function updateDenoDependencyHash(system: string): Promise<void> {
  const original = await Deno.readTextFile(DENO_DEPENDENCY_HASH_FILE_PATH);
  const fake = replaceDenoDependencyHash(original, FAKE_HASH);
  const hash = await buildDenoDependencyHashWithFakeHash(system, original, fake);

  await Deno.writeTextFile(
    DENO_DEPENDENCY_HASH_FILE_PATH,
    replaceDenoDependencyHash(original, hash),
  );
}

export {
  buildDenoDependencyCheck,
  DENO_DEPENDENCY_HASH_FILE_PATH,
  denoDependencyBuildCommand,
  denoDependencyHash,
  isDenoDependencyHashMismatch,
  parsedNixHash,
  replaceDenoDependencyHash,
  updateDenoDependencyHash,
};
export type { DenoDependencyBuildResult };
