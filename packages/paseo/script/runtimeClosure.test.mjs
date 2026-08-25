import {
  RuntimeClosureError,
  enforceTraceWarningPolicy,
  parseTraceWarnings,
} from "./runtimeContract.mjs";
import {
  addExplicitRuntimeFiles,
  materializeRuntimeManifest,
  parseRuntimeManifest,
} from "./runtimeManifest.mjs";
import { describe as nodeDescribe, it as nodeIt } from "node:test";
import { deepStrictEqual as nodeDeepStrictEqual } from "node:assert/strict";
import nodeProcess from "node:process";

/** @type {(actual: unknown, expected: unknown) => void} */
const assertDeepEqual = nodeDeepStrictEqual;
/** @type {(name: string, body: () => void) => void} */
const describe = nodeDescribe;
/** @type {(name: string, body: () => void) => void} */
const it = nodeIt;

const UPSTREAM_MANIFEST = [
  "node_modules/ws/lib/buffer-util.js",
  "node_modules/ws/lib/validation.js",
  "packages/server/node_modules/@esbuild/linux-arm64/bin/esbuild",
  "packages/server/dist/server/server/daemon-worker.js",
  "packages/server/dist/server/terminal/shell-integration/zsh/.zshenv",
];
const MANIFEST = addExplicitRuntimeFiles(UPSTREAM_MANIFEST);
const NODE_PTY_PREBUILD_ROOT = "packages/server/node_modules/node-pty/prebuilds";
const ESBUILD_RUNTIME_FILE = "node_modules/esbuild/lib/main.js";
const ESBUILD_NATIVE_RUNTIME_FILE = "packages/server/node_modules/@esbuild/linux-arm64/bin/esbuild";

const WARNINGS = [
  "Failed to resolve dependency \"pnpapi\":\nCannot find module 'pnpapi' loaded from /build/source/packages/server/node_modules/esbuild/lib/main.js",
  "Failed to parse /build/source/packages/server/node_modules/@esbuild/linux-arm64/bin/esbuild as script:\nUnexpected character '\u007f' (1:0)",
  "Failed to parse /build/source/packages/server/src/server/daemon-worker.ts as module:\nUnexpected token (7:12)",
  "Failed to resolve dependency \"utf-8-validate\":\nCannot find module 'utf-8-validate' loaded from /build/source/node_modules/ws/lib/validation.js",
  "Failed to resolve dependency \"bufferutil\":\nCannot find module 'bufferutil' loaded from /build/source/node_modules/ws/lib/buffer-util.js",
  "Failed to parse /build/source/packages/server/dist/server/terminal/shell-integration/zsh/.zshenv as script:\nUnexpected token (1:11)",
  "Failed to parse /build/source/packages/server/dist/server/terminal/shell-integration/zsh/.zshenv as module:\nUnexpected token (1:11)",
];

/** @param {"directory" | "file" | "special" | "symlink"} kind */
function fileStatus(kind) {
  return {
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symlink",
  };
}

/** @type {NonNullable<Parameters<typeof materializeRuntimeManifest>[2]>} */
const FILE_SYSTEM = {
  existsSync: () => true,
  lstatSync: (candidate) => {
    if (candidate.endsWith("/link") || candidate.endsWith("/node_modules/@getpaseo/client")) {
      return fileStatus("symlink");
    }
    if (candidate.endsWith("/packages/client") || candidate.endsWith("/bundle")) {
      return fileStatus("directory");
    }
    if (candidate.endsWith("/fifo")) {
      return fileStatus("special");
    }
    return fileStatus("file");
  },
  readlinkSync: (candidate) =>
    candidate.endsWith("/link") ? "pad/../target" : "../../packages/client",
  realpathSync: (candidate) => {
    if (candidate.endsWith("/escape")) {
      return "/outside";
    }
    if (candidate.endsWith("/node_modules/@getpaseo/client")) {
      return "/source/packages/client";
    }
    if (candidate.endsWith("/link")) {
      return "/source/target";
    }
    return candidate;
  },
  statSync: (candidate) =>
    candidate.endsWith("/packages/client") ? fileStatus("directory") : fileStatus("file"),
};

/**
 * @param {() => unknown} operation
 * @param {string} message
 */
function assertRuntimeError(operation, message) {
  /** @type {unknown} */
  let result = null;
  try {
    operation();
  } catch (error) {
    result = error;
  }
  if (!(result instanceof RuntimeClosureError) || !result.message.includes(message)) {
    throw new Error(`expected RuntimeClosureError containing ${JSON.stringify(message)}`);
  }
}

describe("Paseo runtime closure policy", () => {
  it("adds platform-native node-pty files omitted by static tracing", () => {
    assertDeepEqual(addExplicitRuntimeFiles(UPSTREAM_MANIFEST, "linux", "x64"), [
      ESBUILD_RUNTIME_FILE,
      "node_modules/ws/lib/buffer-util.js",
      "node_modules/ws/lib/validation.js",
      "packages/server/dist/server/server/daemon-worker.js",
      "packages/server/dist/server/terminal/shell-integration/zsh/.zshenv",
      ESBUILD_NATIVE_RUNTIME_FILE,
      `${NODE_PTY_PREBUILD_ROOT}/linux-x64/pty.node`,
    ]);
    assertDeepEqual(addExplicitRuntimeFiles(UPSTREAM_MANIFEST, "darwin", "arm64"), [
      ESBUILD_RUNTIME_FILE,
      "node_modules/ws/lib/buffer-util.js",
      "node_modules/ws/lib/validation.js",
      "packages/server/dist/server/server/daemon-worker.js",
      "packages/server/dist/server/terminal/shell-integration/zsh/.zshenv",
      ESBUILD_NATIVE_RUNTIME_FILE,
      `${NODE_PTY_PREBUILD_ROOT}/darwin-arm64/pty.node`,
      `${NODE_PTY_PREBUILD_ROOT}/darwin-arm64/spawn-helper`,
    ]);
    assertDeepEqual(addExplicitRuntimeFiles(MANIFEST), MANIFEST);
    assertDeepEqual(
      MANIFEST.includes(
        `${NODE_PTY_PREBUILD_ROOT}/${nodeProcess.platform}-${nodeProcess.arch}/pty.node`,
      ),
      true,
    );
  });

  it("parses only prefixed trace warnings", () => {
    const stderr = WARNINGS.map((warning) => `trace warning: ${warning}`).join("\n");

    assertDeepEqual(parseTraceWarnings(stderr), WARNINGS);
    assertRuntimeError(() => {
      parseTraceWarnings(`unexpected stderr\n${stderr}`);
    }, "unexpected stderr");
  });

  it("accepts audited warnings only with their runtime compensation", () => {
    enforceTraceWarningPolicy(WARNINGS, MANIFEST);

    assertRuntimeError(() => {
      enforceTraceWarningPolicy(["Failed to resolve dependency unknown"], MANIFEST);
    }, "unknown trace warning");
    assertRuntimeError(() => {
      enforceTraceWarningPolicy(WARNINGS, MANIFEST.slice(1));
    }, "missing runtime compensation");
    assertRuntimeError(() => {
      enforceTraceWarningPolicy(
        WARNINGS.filter((warning) => !warning.includes("bufferutil")),
        MANIFEST,
      );
    }, "missing trace warning for ws buffer fallback");
    assertRuntimeError(() => {
      enforceTraceWarningPolicy(
        WARNINGS.filter((warning) => !warning.includes("pnpapi")),
        MANIFEST,
      );
    }, "missing trace warning for esbuild PnP fallback");
    assertRuntimeError(() => {
      enforceTraceWarningPolicy(
        WARNINGS.filter((warning) => !warning.includes("@esbuild/linux-arm64")),
        MANIFEST,
      );
    }, "missing trace warning for esbuild native binary");
  });

  it("accepts only deterministic repository-relative manifests", () => {
    assertDeepEqual(parseRuntimeManifest(`${MANIFEST.join("\n")}\n`), MANIFEST);
    assertRuntimeError(() => {
      parseRuntimeManifest("packages/server/dist/index.js\n..\n");
    }, "invalid runtime path");
    assertRuntimeError(() => {
      parseRuntimeManifest("packages/server/dist/index.js\n../outside.js\n");
    }, "invalid runtime path");
    assertRuntimeError(() => {
      parseRuntimeManifest("z.js\na.js\n");
    }, "sorted");
    assertRuntimeError(() => {
      parseRuntimeManifest("-option\n");
    }, "invalid runtime path");
    assertRuntimeError(() => {
      parseRuntimeManifest("directory/\n");
    }, "invalid runtime path");
  });

  it("materializes an explicit leaf closure", () => {
    assertDeepEqual(
      materializeRuntimeManifest(
        "/source",
        ["node_modules/@getpaseo/client", "packages/client", "packages/client/index.js"],
        FILE_SYSTEM,
      ),
      ["node_modules/@getpaseo/client", "packages/client/index.js"],
    );
    assertDeepEqual(
      materializeRuntimeManifest("/source", ["bundle", "bundle/index.js"], FILE_SYSTEM),
      ["bundle/index.js"],
    );
    assertRuntimeError(() => {
      materializeRuntimeManifest("/source", ["escape"], FILE_SYSTEM);
    }, "escapes source root");
    assertRuntimeError(() => {
      materializeRuntimeManifest("/source", ["fifo"], FILE_SYSTEM);
    }, "unsupported type");
    assertRuntimeError(() => {
      materializeRuntimeManifest("/source", ["link", "target"], FILE_SYSTEM);
    }, "must be normalized and relative");
  });
});
