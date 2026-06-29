import {
  UpdateError,
  commandOutput,
  updateNewerPinVersion,
  writeTextFile,
} from "./updateScript.ts";
import { Effect } from "effect";
import { withTemporaryDirectory } from "./temporaryDirectory.ts";
import { writePinJson } from "./pinJson.ts";

const ROOT_PROJECT_NAME = "coolheaded-lock-input";
const ROOT_PROJECT_VERSION = "0";

interface UvProject {
  readonly dependencies: readonly string[];
  readonly extraBuildDependencies?: Readonly<Record<string, readonly string[]>>;
  readonly name?: string;
  readonly optionalDependencies?: Readonly<Record<string, readonly string[]>>;
  readonly pythonMinorVersion: string;
  readonly version?: string;
}

interface VersionedUvLockUpdate {
  readonly args: readonly string[];
  readonly latestVersion: () => Effect.Effect<string, Error>;
  readonly pinFilePath: string;
  readonly project: (version: string) => UvProject;
  readonly repositoryRootPath: string;
  readonly uvLockFilePath: string;
}

interface VersionedNixpkgsPythonUvLockUpdate {
  readonly args: readonly string[];
  readonly latestVersion: () => Effect.Effect<string, Error>;
  readonly pinFilePath: string;
  readonly project: (version: string, pythonMinorVersion: string) => UvProject;
  readonly pythonPackage: string;
  readonly repositoryRootPath: string;
  readonly uvLockFilePath: string;
}

function pythonRequirement(pythonMinorVersion: string): string {
  const match = /^(?<major>\d+)\.(?<minor>\d+)$/u.exec(pythonMinorVersion);
  if (match?.groups === undefined) {
    throw new Error(`Invalid Python minor version: ${pythonMinorVersion}`);
  }

  const major = Math.trunc(Number(match.groups["major"] ?? ""));
  const minor = Math.trunc(Number(match.groups["minor"] ?? ""));
  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    throw new TypeError(`Invalid Python minor version: ${pythonMinorVersion}`);
  }

  return `>=${major}.${minor}`;
}

function parsePythonMinorVersion(value: string, source: string): string {
  const pythonMinorVersion = value.trim();
  if (/^\d+\.\d+$/u.test(pythonMinorVersion)) {
    return pythonMinorVersion;
  }

  throw new UpdateError(`Invalid Python minor version from ${source}: ${pythonMinorVersion}`);
}

function nixpkgsPythonMinorVersion(
  repositoryRootPath: string,
  pythonPackage: string,
): Effect.Effect<string, Error> {
  return Effect.map(
    commandOutput("nix", [
      "eval",
      "--inputs-from",
      repositoryRootPath,
      "--raw",
      `nixpkgs#${pythonPackage}.pythonVersion`,
    ]),
    (version: string): string => parsePythonMinorVersion(version, pythonPackage),
  );
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: readonly string[]): string {
  return `[${values.map((value: string): string => tomlString(value)).join(", ")}]`;
}

function tomlTableArrays(
  header: string,
  values: Readonly<Record<string, readonly string[]>> | undefined,
): string {
  if (values === undefined || Object.keys(values).length === 0) {
    return "";
  }

  const entries = Object.entries(values)
    .toSorted(
      (
        [left]: readonly [string, readonly string[]],
        [right]: readonly [string, readonly string[]],
      ) => left.localeCompare(right),
    )
    .map(
      ([name, packages]: readonly [string, readonly string[]]): string =>
        `${name} = ${tomlArray(packages)}`,
    )
    .join("\n");

  return `\n[${header}]\n${entries}\n`;
}

function uvProjectContents(project: UvProject): string {
  return `[project]
name = ${tomlString(project.name ?? ROOT_PROJECT_NAME)}
version = ${tomlString(project.version ?? ROOT_PROJECT_VERSION)}
requires-python = ${tomlString(pythonRequirement(project.pythonMinorVersion))}
dependencies = ${tomlArray(project.dependencies)}
${tomlTableArrays("project.optional-dependencies", project.optionalDependencies)}${tomlTableArrays(
    "tool.uv.extra-build-dependencies",
    project.extraBuildDependencies,
  )}`;
}

function generatedUvLock(
  repositoryRootPath: string,
  project: UvProject,
): Effect.Effect<string, Error> {
  return withTemporaryDirectory(
    (workspacePath: string): Effect.Effect<string, Error> =>
      Effect.zipRight(
        writeTextFile(`${workspacePath}/pyproject.toml`, uvProjectContents(project)),
        Effect.zipRight(
          commandOutput(
            "nix",
            [
              "run",
              "--inputs-from",
              repositoryRootPath,
              "nixpkgs#uv",
              "--",
              "lock",
              "--project",
              workspacePath,
              "--no-progress",
            ],
            repositoryRootPath,
          ),
          commandOutput("cat", [`${workspacePath}/uv.lock`]),
        ),
      ),
  );
}

function updateVersionedUvLock(options: VersionedUvLockUpdate): Effect.Effect<void, Error> {
  return updateNewerPinVersion(
    options.args,
    options.latestVersion,
    options.pinFilePath,
    (version: string): Effect.Effect<void, Error> =>
      Effect.flatMap(
        generatedUvLock(options.repositoryRootPath, options.project(version)),
        (uvLock: string): Effect.Effect<void> =>
          Effect.zipRight(
            writePinJson(options.pinFilePath, { version }),
            writeTextFile(options.uvLockFilePath, `${uvLock.trim()}\n`),
          ),
      ),
  );
}

function updateVersionedNixpkgsPythonUvLock(
  options: VersionedNixpkgsPythonUvLockUpdate,
): Effect.Effect<void, Error> {
  return Effect.flatMap(
    nixpkgsPythonMinorVersion(options.repositoryRootPath, options.pythonPackage),
    (pythonMinorVersion: string): Effect.Effect<void, Error> =>
      updateVersionedUvLock({
        args: options.args,
        latestVersion: options.latestVersion,
        pinFilePath: options.pinFilePath,
        project: (version: string): UvProject => options.project(version, pythonMinorVersion),
        repositoryRootPath: options.repositoryRootPath,
        uvLockFilePath: options.uvLockFilePath,
      }),
  );
}

export {
  generatedUvLock,
  nixpkgsPythonMinorVersion,
  updateVersionedNixpkgsPythonUvLock,
  updateVersionedUvLock,
  uvProjectContents,
};
export type { UvProject, VersionedNixpkgsPythonUvLockUpdate, VersionedUvLockUpdate };
