const DENO_DEPS_HASH_FILE_PATH = "flake/denoDependencies.nix";
const FAKE_HASH = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

interface DenoDepsBuildResult {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}

function denoDepsHashPattern(): RegExp {
  return /(?<prefix>hash = ")sha256-[A-Za-z0-9+/=]+(?<suffix>";)/u;
}

function denoDepsHash(content: string): string {
  const match = denoDepsHashPattern().exec(content);
  if (match?.[0] === undefined) {
    throw new Error("Missing Deno deps hash");
  }

  const hashMatch = /sha256-[A-Za-z0-9+/=]+/u.exec(match[0]);
  if (hashMatch?.[0] === undefined) {
    throw new Error("Malformed Deno deps hash");
  }

  return hashMatch[0];
}

function replaceDenoDepsHash(content: string, hash: string): string {
  const pattern = denoDepsHashPattern();
  if (!pattern.test(content)) {
    throw new Error("Missing Deno deps hash");
  }

  return content.replace(pattern, `$<prefix>${hash}$<suffix>`);
}

function denoDepsBuildCommand(system: string): readonly string[] {
  return ["nix", "build", `.#checks.${system}.denoDependencies`, "--no-link", "--print-build-logs"];
}

function parsedNixHash(output: string): string {
  const match = /got:\s+(?<hash>sha256-[A-Za-z0-9+/=]+)/u.exec(output);
  if (match?.groups?.["hash"] === undefined) {
    throw new Error(`Unable to parse Nix fixed-output hash from output:\n${output}`);
  }

  return match.groups["hash"];
}

function isDenoDepsHashMismatch(output: string): boolean {
  return (
    output.includes("coolheaded-deno-dependencies") && /got:\s+sha256-[A-Za-z0-9+/=]+/u.test(output)
  );
}

async function buildDenoDepsCheck(system: string): Promise<DenoDepsBuildResult> {
  const [command, ...args] = denoDepsBuildCommand(system);
  if (command === undefined) {
    throw new Error("Missing Deno deps build command");
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

async function buildDenoDepsHash(system: string): Promise<string> {
  const result = await buildDenoDepsCheck(system);
  if (result.code === 0) {
    throw new Error("Expected fake Deno deps hash to fail, but the build succeeded");
  }

  return parsedNixHash(`${result.stdout}\n${result.stderr}`);
}

async function buildDenoDepsHashWithFakeHash(
  system: string,
  original: string,
  fake: string,
): Promise<string> {
  await Deno.writeTextFile(DENO_DEPS_HASH_FILE_PATH, fake);
  try {
    return await buildDenoDepsHash(system);
  } finally {
    await Deno.writeTextFile(DENO_DEPS_HASH_FILE_PATH, original);
  }
}

async function updateDenoDepsHash(system: string): Promise<void> {
  const original = await Deno.readTextFile(DENO_DEPS_HASH_FILE_PATH);
  const fake = replaceDenoDepsHash(original, FAKE_HASH);
  const hash = await buildDenoDepsHashWithFakeHash(system, original, fake);

  await Deno.writeTextFile(DENO_DEPS_HASH_FILE_PATH, replaceDenoDepsHash(original, hash));
}

export {
  buildDenoDepsCheck,
  DENO_DEPS_HASH_FILE_PATH,
  denoDepsBuildCommand,
  denoDepsHash,
  isDenoDepsHashMismatch,
  parsedNixHash,
  replaceDenoDepsHash,
  updateDenoDepsHash,
};
export type { DenoDepsBuildResult };
