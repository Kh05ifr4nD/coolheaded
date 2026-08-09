import {
  RuntimeClosureError,
  enforceTraceWarningPolicy,
  parseTraceWarnings,
} from "./runtimeContract.mjs";
import { assertEquals, assertThrows } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";
import { materializeRuntimeManifest, parseRuntimeManifest } from "./runtimeManifest.mjs";

const MANIFEST = [
  "node_modules/@parcel/watcher-linux-x64-glibc/watcher.node",
  "node_modules/ws/lib/buffer-util.js",
  "node_modules/ws/lib/validation.js",
  "packages/server/dist/server/server/daemon-worker.js",
  "packages/server/dist/server/terminal/shell-integration/zsh/.zshenv",
];

const WARNINGS = [
  "Failed to parse /build/source/packages/server/src/server/daemon-worker.ts as module:\nUnexpected token (7:12)",
  "Failed to resolve dependency \"./build/Release/watcher.node\":\nCannot find module './build/Release/watcher.node' loaded from /build/source/node_modules/@parcel/watcher/index.js",
  "Failed to resolve dependency \"./build/Debug/watcher.node\":\nCannot find module './build/Debug/watcher.node' loaded from /build/source/node_modules/@parcel/watcher/index.js",
  "Failed to resolve dependency \"@parcel/watcher-\u001A-\u001A\":\nCannot find module '@parcel/watcher-\u001A-\u001A' loaded from /build/source/node_modules/@parcel/watcher/index.js",
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

describe("Paseo runtime closure policy", () => {
  it("parses only prefixed trace warnings", () => {
    const stderr = WARNINGS.map((warning) => `trace warning: ${warning}`).join("\n");

    assertEquals(parseTraceWarnings(stderr), WARNINGS);
    assertThrows(
      () => {
        parseTraceWarnings(`unexpected stderr\n${stderr}`);
      },
      RuntimeClosureError,
      "unexpected stderr",
    );
  });

  it("accepts audited warnings only with their runtime compensation", () => {
    enforceTraceWarningPolicy(WARNINGS, MANIFEST);

    assertThrows(
      () => {
        enforceTraceWarningPolicy(["Failed to resolve dependency unknown"], MANIFEST);
      },
      RuntimeClosureError,
      "unknown trace warning",
    );
    assertThrows(
      () => {
        enforceTraceWarningPolicy(WARNINGS, MANIFEST.slice(1));
      },
      RuntimeClosureError,
      "missing runtime compensation",
    );
    assertThrows(
      () => {
        enforceTraceWarningPolicy(
          WARNINGS.filter((warning) => !warning.includes("bufferutil")),
          MANIFEST,
        );
      },
      RuntimeClosureError,
      "missing trace warning for ws buffer fallback",
    );
  });

  it("accepts only deterministic repository-relative manifests", () => {
    assertEquals(parseRuntimeManifest(`${MANIFEST.join("\n")}\n`), MANIFEST);
    assertThrows(
      () => {
        parseRuntimeManifest("packages/server/dist/index.js\n..\n");
      },
      RuntimeClosureError,
      "invalid runtime path",
    );
    assertThrows(
      () => {
        parseRuntimeManifest("packages/server/dist/index.js\n../outside.js\n");
      },
      RuntimeClosureError,
      "invalid runtime path",
    );
    assertThrows(
      () => {
        parseRuntimeManifest("z.js\na.js\n");
      },
      RuntimeClosureError,
      "sorted",
    );
    assertThrows(
      () => {
        parseRuntimeManifest("-option\n");
      },
      RuntimeClosureError,
      "invalid runtime path",
    );
    assertThrows(
      () => {
        parseRuntimeManifest("directory/\n");
      },
      RuntimeClosureError,
      "invalid runtime path",
    );
  });

  it("materializes an explicit leaf closure", () => {
    assertEquals(
      materializeRuntimeManifest(
        "/source",
        ["node_modules/@getpaseo/client", "packages/client", "packages/client/index.js"],
        FILE_SYSTEM,
      ),
      ["node_modules/@getpaseo/client", "packages/client/index.js"],
    );
    assertEquals(
      materializeRuntimeManifest("/source", ["bundle", "bundle/index.js"], FILE_SYSTEM),
      ["bundle/index.js"],
    );
    assertThrows(
      () => {
        materializeRuntimeManifest("/source", ["escape"], FILE_SYSTEM);
      },
      RuntimeClosureError,
      "escapes source root",
    );
    assertThrows(
      () => {
        materializeRuntimeManifest("/source", ["fifo"], FILE_SYSTEM);
      },
      RuntimeClosureError,
      "unsupported type",
    );
    assertThrows(
      () => {
        materializeRuntimeManifest("/source", ["link", "target"], FILE_SYSTEM);
      },
      RuntimeClosureError,
      "must be normalized and relative",
    );
  });
});
