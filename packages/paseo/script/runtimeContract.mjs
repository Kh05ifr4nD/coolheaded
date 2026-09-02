const TRACE_WARNING_PREFIX = "trace warning: ";

/**
 * Each policy classifies one trace warning and declares how the warning is
 * handled. Runtime gaps require a manifest compensation; non-runtime
 * diagnostics are ignored. Required policies must appear in every trace so
 * upstream drift cannot leave stale exceptions behind.
 *
 * @typedef {Readonly<{
 *   effect: Readonly<{
 *     manifestPattern: RegExp,
 *     type: "require-manifest",
 *   }> | Readonly<{ type: "ignore" }>,
 *   id: string,
 *   warningPattern: RegExp,
 * }>} TraceWarningPolicy
 */
/** @type {readonly TraceWarningPolicy[]} */
const WARNING_POLICIES = [
  {
    effect: {
      manifestPattern: /^packages\/server\/dist\/server\/server\/daemon-worker\.js$/u,
      type: "require-manifest",
    },
    id: "development daemon source",
    warningPattern:
      /^Failed to parse .*\/packages\/server\/src\/server\/daemon-worker\.ts as module:\nUnexpected token \(\d+:\d+\)$/u,
  },
  {
    effect: {
      manifestPattern: /^node_modules\/ws\/lib\/buffer-util\.js$/u,
      type: "require-manifest",
    },
    id: "ws buffer fallback",
    warningPattern:
      /^Failed to resolve dependency "bufferutil":\nCannot find module 'bufferutil' loaded from .*\/node_modules\/ws\/lib\/buffer-util\.js$/u,
  },
  {
    effect: {
      manifestPattern: /^node_modules\/ws\/lib\/validation\.js$/u,
      type: "require-manifest",
    },
    id: "ws UTF-8 fallback",
    warningPattern:
      /^Failed to resolve dependency "utf-8-validate":\nCannot find module 'utf-8-validate' loaded from .*\/node_modules\/ws\/lib\/validation\.js$/u,
  },
  {
    effect: {
      manifestPattern: /^node_modules\/esbuild\/lib\/main\.js$/u,
      type: "require-manifest",
    },
    id: "esbuild PnP fallback",
    warningPattern:
      /^Failed to resolve dependency "pnpapi":\nCannot find module 'pnpapi' loaded from .*\/node_modules\/esbuild\/lib\/main\.js$/u,
  },
  {
    effect: {
      manifestPattern: /^packages\/server\/node_modules\/@esbuild\/[^/]+\/bin\/esbuild$/u,
      type: "require-manifest",
    },
    id: "esbuild native binary",
    warningPattern:
      /^Failed to parse .*\/packages\/server\/node_modules\/@esbuild\/[^/]+\/bin\/esbuild as (?:module|script):\nUnexpected character .+ \(1:0\)$/u,
  },
  {
    effect: {
      manifestPattern:
        /^packages\/server\/dist\/server\/terminal\/shell-integration\/zsh\/\.zshenv$/u,
      type: "require-manifest",
    },
    id: "Zsh integration asset",
    warningPattern:
      /^Failed to parse .*\/packages\/server\/dist\/server\/terminal\/shell-integration\/zsh\/\.zshenv as (?:module|script):\nUnexpected token \(\d+:\d+\)$/u,
  },
  {
    effect: { type: "ignore" },
    id: "TypeScript declaration output",
    warningPattern: /^Failed to parse .*\.d\.ts as (?:module|script):\n[\s\S]+$/u,
  },
];

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

    const [policy] = policies;
    matchedPolicyIds.add(policy.id);
    const { effect } = policy;
    switch (effect.type) {
      case "ignore": {
        break;
      }
      case "require-manifest": {
        if (!manifest.some((entry) => effect.manifestPattern.test(entry))) {
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
    switch (policy.effect.type) {
      case "ignore": {
        break;
      }
      case "require-manifest": {
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
