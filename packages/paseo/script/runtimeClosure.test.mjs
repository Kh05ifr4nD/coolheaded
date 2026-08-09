import {
  RuntimeClosureError,
  enforceTraceWarningPolicy,
  parseRuntimeManifest,
  parseTraceWarnings,
} from "./runtimeClosure.mjs";
import { assertEquals, assertThrows } from "@jsr/std__assert";
import { describe, it } from "@jsr/std__testing/bdd";

const MANIFEST = [
  "node_modules/@parcel/watcher-linux-x64-glibc/watcher.node",
  "node_modules/ws/lib/buffer-util.js",
  "node_modules/ws/lib/validation.js",
  "packages/server/dist/server/server/daemon-worker.js",
  "packages/server/dist/server/terminal/shell-integration/zsh/.zshenv",
];

const WARNINGS = [
  "Failed to parse /build/source/packages/server/src/server/daemon-worker.ts as module:\nUnexpected token (7:12)",
  "Failed to resolve dependency \"@parcel/watcher-\u001A-\u001A\":\nCannot find module '@parcel/watcher-\u001A-\u001A' loaded from /build/source/node_modules/@parcel/watcher/index.js",
  "Failed to resolve dependency \"utf-8-validate\":\nCannot find module 'utf-8-validate' loaded from /build/source/node_modules/ws/lib/validation.js",
  "Failed to parse /build/source/packages/server/dist/server/terminal/shell-integration/zsh/.zshenv as script:\nUnexpected token (1:11)",
];

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
  });

  it("accepts only deterministic repository-relative manifests", () => {
    assertEquals(parseRuntimeManifest(`${MANIFEST.join("\n")}\n`), MANIFEST);
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
  });
});
