import { compareVersions, isSemver } from "coolheaded/core/version.ts";
import type { CommandRunner } from "coolheaded/core/commandRunner.ts";
import { Effect } from "effect";
import { denoCommandRunner } from "coolheaded/core/denoCommandRunner.ts";

interface RuntimeWritable {
  readonly write: (bytes: unknown) => Promise<number>;
}

interface DenoRuntime {
  readonly args: readonly string[];
  readonly exit: (code: number) => never;
  readonly mainModule: string;
  readonly readTextFile: (path: string) => Promise<string>;
  readonly stderr: RuntimeWritable;
  readonly writeTextFile: (path: string, data: string) => Promise<void>;
}

class UpdateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UpdateError";
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDenoRuntime(value: unknown): value is DenoRuntime {
  if (!isRecord(value) || !isRecord(value["stderr"])) {
    return false;
  }

  return (
    Array.isArray(value["args"]) &&
    typeof value["mainModule"] === "string" &&
    typeof value["exit"] === "function" &&
    typeof value["readTextFile"] === "function" &&
    typeof value["writeTextFile"] === "function" &&
    typeof value["stderr"]["write"] === "function"
  );
}

function denoRuntime(): DenoRuntime {
  const runtime = Reflect.get(globalThis, "Deno");
  if (isDenoRuntime(runtime)) {
    return runtime;
  }

  throw new Error("Deno runtime is unavailable");
}

function scriptPath(relativePath: string, moduleUrl: string): string {
  return new globalThis.URL(relativePath, moduleUrl).pathname;
}

function requestedVersion(
  args: readonly string[],
  usage: string,
): Effect.Effect<string, UpdateError> {
  const [version] = args;

  if (typeof version !== "string" || version.length === 0) {
    return Effect.fail(new UpdateError(usage));
  }

  return Effect.succeed(version);
}

function requestedOrLatestVersion(
  args: readonly string[],
  latestVersion: () => Effect.Effect<string, Error>,
): Effect.Effect<string, Error> {
  const [version] = args;

  if (typeof version === "string" && version.length > 0) {
    return Effect.succeed(version);
  }

  return latestVersion();
}

function writeTextFile(path: string, contents: string): Effect.Effect<void> {
  return Effect.promise((): Promise<void> => denoRuntime().writeTextFile(path, contents));
}

function readTextFile(path: string): Effect.Effect<string, UpdateError> {
  return Effect.tryPromise({
    catch(error: unknown): UpdateError {
      if (error instanceof UpdateError) {
        return error;
      }

      return new UpdateError(`Failed to read ${path}`);
    },
    try: (): Promise<string> => denoRuntime().readTextFile(path),
  });
}

function semverVersion(version: string, source: string): Effect.Effect<string, UpdateError> {
  return isSemver(version)
    ? Effect.succeed(version)
    : Effect.fail(new UpdateError(`${source} is not valid SemVer: ${version}`));
}

function currentPinVersion(pinPath: string): Effect.Effect<string, Error> {
  return Effect.flatMap(
    readTextFile(pinPath),
    (contents: string): Effect.Effect<string, Error> =>
      Effect.flatMap(
        Effect.try({
          catch: (): UpdateError => new UpdateError(`Failed to parse ${pinPath}`),
          try: (): unknown => JSON.parse(contents),
        }),
        (pin: unknown): Effect.Effect<string, Error> => {
          if (!isRecord(pin) || typeof pin["version"] !== "string" || pin["version"].length === 0) {
            return Effect.fail(new UpdateError(`${pinPath} does not contain a string version`));
          }

          return semverVersion(pin["version"], `${pinPath} version`);
        },
      ),
  );
}

function newerPinVersion(currentVersion: string, candidateVersion: string): string | undefined {
  return compareVersions(currentVersion, candidateVersion) < 0 ? candidateVersion : undefined;
}

function requestedOrNewerPinVersion(
  args: readonly string[],
  latestVersion: () => Effect.Effect<string, Error>,
  pinPath: string,
): Effect.Effect<string | undefined, Error> {
  const [version] = args;

  if (typeof version === "string" && version.length > 0) {
    return semverVersion(version, "Requested version");
  }

  return Effect.flatMap(currentPinVersion(pinPath), (currentVersion: string) =>
    Effect.flatMap(latestVersion(), (candidateVersion: string) =>
      Effect.map(
        semverVersion(candidateVersion, "Latest version"),
        (validCandidateVersion: string): string | undefined =>
          newerPinVersion(currentVersion, validCandidateVersion),
      ),
    ),
  );
}

function updateNewerPinVersion(
  args: readonly string[],
  latestVersion: () => Effect.Effect<string, Error>,
  pinPath: string,
  updateVersion: (version: string) => Effect.Effect<void, Error>,
): Effect.Effect<void, Error> {
  return Effect.flatMap(
    requestedOrNewerPinVersion(args, latestVersion, pinPath),
    (version: string | undefined): Effect.Effect<void, Error> =>
      version === undefined ? Effect.void : updateVersion(version),
  );
}

function commandOutput(
  runner: CommandRunner,
  command: string,
  args: readonly string[],
  cwd?: string,
): Effect.Effect<string, UpdateError> {
  return Effect.tryPromise({
    catch(error: unknown): UpdateError {
      if (error instanceof UpdateError) {
        return error;
      }

      return new UpdateError(`Failed to run ${command}`);
    },
    async try(): Promise<string> {
      const output = await runner.run({
        command: [command, ...args],
        ...(typeof cwd === "string" ? { cwd } : {}),
      });

      if (output.code !== 0) {
        const stderr = output.stderr.trim();
        throw new UpdateError(
          `Failed to run ${command}: exit ${output.code}${
            stderr.length === 0 ? "" : `: ${stderr}`
          }`,
        );
      }

      return output.stdout.trim();
    },
  });
}

function formatNixFile(runner: CommandRunner, path: string): Effect.Effect<void, UpdateError> {
  return Effect.asVoid(commandOutput(runner, "nix", ["fmt", "--", path]));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function reportError(error: unknown): Promise<void> {
  const encodedError = new globalThis.TextEncoder().encode(`${errorMessage(error)}\n`);
  await denoRuntime().stderr.write(encodedError);
  denoRuntime().exit(1);
}

function reportErrorEffect(error: unknown): Effect.Effect<void> {
  return Effect.promise(async (): Promise<void> => {
    await reportError(error);
  });
}

function runUpdateScript(
  moduleUrl: string,
  program: (args: readonly string[], runner: CommandRunner) => Effect.Effect<void, Error>,
): void {
  if (denoRuntime().mainModule === moduleUrl) {
    const updateEffect = program(denoRuntime().args, denoCommandRunner);
    const reportedEffect = Effect.catchAll(updateEffect, reportErrorEffect);

    Effect.runFork(reportedEffect);
  }
}

export {
  commandOutput,
  denoRuntime,
  formatNixFile,
  newerPinVersion,
  readTextFile,
  requestedOrLatestVersion,
  requestedOrNewerPinVersion,
  requestedVersion,
  runUpdateScript,
  scriptPath,
  UpdateError,
  updateNewerPinVersion,
  writeTextFile,
};
