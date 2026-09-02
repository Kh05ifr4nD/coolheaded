const TRACE_WARNING_PREFIX = "trace warning: ";

/**
 * Each policy classifies one trace warning and declares how the warning is
 * handled. Runtime gaps require a static or derived manifest compensation;
 * non-runtime diagnostics are ignored. Policies that require compensation
 * must appear in every trace so upstream drift cannot leave stale exceptions
 * behind.
 *
 * @typedef {Readonly<{
 *   id: string,
 *   warningPattern: RegExp,
 * }> & (
 *   | Readonly<{ effect: "ignore" }>
 *   | Readonly<{ effect: "require-manifest", manifestPattern: RegExp }>
 *   | Readonly<{
 *       deriveManifestEntry: (warning: string) => string,
 *       effect: "require-derived-manifest",
 *     }>
 * )} TraceWarningPolicy
 */

class RuntimeClosureError extends Error {
  /**
   * @param {string} message
   * @param {{ readonly cause?: unknown }} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = "RuntimeClosureError";
  }
}

const TYPESCRIPT_SOURCE_WARNING_PATTERN =
  /^Failed to parse .+\/packages\/server\/src\/(?![^\n]*\.d\.(?:cts|mts|tsx?) as (?:module|script):\n)[^\n]+\.(?:cts|mts|tsx?) as (?:module|script):\n[\s\S]+$/u;
const TYPESCRIPT_SOURCE_PATH_PATTERN =
  /^Failed to parse .+\/(?<sourcePath>packages\/server\/src\/[^\n]+) as (?:module|script):\n/u;

/** @param {string} warning */
function deriveTypeScriptRuntimeEntry(warning) {
  const match = TYPESCRIPT_SOURCE_PATH_PATTERN.exec(warning);
  const sourcePath = match?.groups?.sourcePath;
  if (sourcePath === undefined) {
    throw new RuntimeClosureError(`invalid TypeScript source warning:\n${warning}`);
  }

  const sourceRoot = "packages/server/src/";
  const relativePath = sourcePath.slice(sourceRoot.length);
  const extensionIndex = relativePath.lastIndexOf(".");
  if (extensionIndex === -1) {
    throw new RuntimeClosureError(`invalid TypeScript source warning:\n${warning}`);
  }

  const sourceExtension = relativePath.slice(extensionIndex);
  let outputExtension = ".js";
  if (sourceExtension === ".mts") {
    outputExtension = ".mjs";
  } else if (sourceExtension === ".cts") {
    outputExtension = ".cjs";
  }
  return `packages/server/dist/server/${relativePath.slice(0, extensionIndex)}${outputExtension}`;
}

/** @type {readonly TraceWarningPolicy[]} */
const WARNING_POLICIES = [
  {
    deriveManifestEntry: deriveTypeScriptRuntimeEntry,
    effect: "require-derived-manifest",
    id: "TypeScript source module",
    warningPattern: TYPESCRIPT_SOURCE_WARNING_PATTERN,
  },
  {
    effect: "require-manifest",
    id: "ws buffer fallback",
    manifestPattern: /^node_modules\/ws\/lib\/buffer-util\.js$/u,
    warningPattern:
      /^Failed to resolve dependency "bufferutil":\nCannot find module 'bufferutil' loaded from .*\/node_modules\/ws\/lib\/buffer-util\.js$/u,
  },
  {
    effect: "require-manifest",
    id: "ws UTF-8 fallback",
    manifestPattern: /^node_modules\/ws\/lib\/validation\.js$/u,
    warningPattern:
      /^Failed to resolve dependency "utf-8-validate":\nCannot find module 'utf-8-validate' loaded from .*\/node_modules\/ws\/lib\/validation\.js$/u,
  },
  {
    effect: "require-manifest",
    id: "esbuild PnP fallback",
    manifestPattern: /^node_modules\/esbuild\/lib\/main\.js$/u,
    warningPattern:
      /^Failed to resolve dependency "pnpapi":\nCannot find module 'pnpapi' loaded from .*\/node_modules\/esbuild\/lib\/main\.js$/u,
  },
  {
    effect: "require-manifest",
    id: "esbuild native binary",
    manifestPattern: /^packages\/server\/node_modules\/@esbuild\/[^/]+\/bin\/esbuild$/u,
    warningPattern:
      /^Failed to parse .*\/packages\/server\/node_modules\/@esbuild\/[^/]+\/bin\/esbuild as (?:module|script):\nUnexpected character .+ \(1:0\)$/u,
  },
  {
    effect: "require-manifest",
    id: "Zsh integration asset",
    manifestPattern:
      /^packages\/server\/dist\/server\/terminal\/shell-integration\/zsh\/\.zshenv$/u,
    warningPattern:
      /^Failed to parse .*\/packages\/server\/dist\/server\/terminal\/shell-integration\/zsh\/\.zshenv as (?:module|script):\nUnexpected token \(\d+:\d+\)$/u,
  },
  {
    effect: "ignore",
    id: "TypeScript declaration output",
    warningPattern: /^Failed to parse .*\.d\.(?:cts|mts|tsx?) as (?:module|script):\n[\s\S]+$/u,
  },
];

/**
 * @param {string} stderr
 * @returns {readonly string[]}
 */
function parseTraceWarnings(stderr) {
  const output = stderr.trim();
  if (output.length === 0) {
    return [];
  }
  if (!output.startsWith(TRACE_WARNING_PREFIX)) {
    throw new RuntimeClosureError(`unexpected stderr from upstream runtime trace:\n${output}`);
  }

  const [preamble, ...warnings] = output.split(TRACE_WARNING_PREFIX);
  if (preamble !== "" || warnings.some((warning) => warning.trim().length === 0)) {
    throw new RuntimeClosureError(`malformed upstream runtime trace warnings:\n${output}`);
  }
  return warnings.map((warning) => warning.trim());
}

/**
 * @param {readonly string[]} warnings
 * @param {readonly string[]} manifest
 * @returns {void}
 */
function enforceTraceWarningPolicy(warnings, manifest) {
  /** @type {Set<string>} */
  const matchedPolicyIds = new Set();
  for (const warning of warnings) {
    const policies = WARNING_POLICIES.filter(({ warningPattern }) => warningPattern.test(warning));
    if (policies.length !== 1) {
      throw new RuntimeClosureError(`unknown trace warning:\n${warning}`);
    }

    const policy = policies[0];
    if (policy === undefined) {
      throw new RuntimeClosureError(`unknown trace warning:\n${warning}`);
    }
    matchedPolicyIds.add(policy.id);
    switch (policy.effect) {
      case "ignore": {
        break;
      }
      case "require-manifest": {
        if (!manifest.some((entry) => policy.manifestPattern.test(entry))) {
          throw new RuntimeClosureError(
            `missing runtime compensation for ${policy.id}:\n${warning}`,
          );
        }
        break;
      }
      case "require-derived-manifest": {
        const manifestEntry = policy.deriveManifestEntry(warning);
        if (!manifest.includes(manifestEntry)) {
          throw new RuntimeClosureError(
            `missing runtime compensation for ${policy.id}:\n${warning}`,
          );
        }
        break;
      }
      default: {
        throw new RuntimeClosureError(`unsupported trace warning effect for ${policy.id}`);
      }
    }
  }

  for (const policy of WARNING_POLICIES) {
    switch (policy.effect) {
      case "ignore": {
        break;
      }
      case "require-manifest": {
        if (!matchedPolicyIds.has(policy.id)) {
          throw new RuntimeClosureError(`missing trace warning for ${policy.id}`);
        }
        break;
      }
      case "require-derived-manifest": {
        if (!matchedPolicyIds.has(policy.id)) {
          throw new RuntimeClosureError(`missing trace warning for ${policy.id}`);
        }
        break;
      }
      default: {
        throw new RuntimeClosureError(`unsupported trace warning effect for ${policy.id}`);
      }
    }
  }
}

export { RuntimeClosureError, enforceTraceWarningPolicy, parseTraceWarnings };
