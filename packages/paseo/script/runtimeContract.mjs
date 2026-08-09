const TRACE_WARNING_PREFIX = "trace warning: ";

/**
 * Each accepted warning names the concrete runtime artifact that makes the
 * static-analysis gap safe. Warnings, policies, and compensations must remain
 * mutually supported so upstream drift cannot leave stale exceptions behind.
 *
 * @type {readonly Readonly<{
 *   id: string,
 *   manifestPattern: RegExp,
 *   warningPattern: RegExp,
 * }>[]}
 */
const WARNING_POLICIES = [
  {
    id: "development daemon source",
    manifestPattern: /^packages\/server\/dist\/server\/server\/daemon-worker\.js$/u,
    warningPattern:
      /^Failed to parse .*\/packages\/server\/src\/server\/daemon-worker\.ts as module:\nUnexpected token \(\d+:\d+\)$/u,
  },
  {
    id: "Parcel watcher native package",
    manifestPattern: /^node_modules\/@parcel\/watcher-[^/]+\/watcher\.node$/u,
    warningPattern:
      /^Failed to resolve dependency "(?:\.\/build\/(?:Release|Debug)\/watcher\.node|@parcel\/watcher-[^"]+)":\nCannot find module .* loaded from .*\/node_modules\/@parcel\/watcher\/index\.js$/u,
  },
  {
    id: "ws buffer fallback",
    manifestPattern: /^node_modules\/ws\/lib\/buffer-util\.js$/u,
    warningPattern:
      /^Failed to resolve dependency "bufferutil":\nCannot find module 'bufferutil' loaded from .*\/node_modules\/ws\/lib\/buffer-util\.js$/u,
  },
  {
    id: "ws UTF-8 fallback",
    manifestPattern: /^node_modules\/ws\/lib\/validation\.js$/u,
    warningPattern:
      /^Failed to resolve dependency "utf-8-validate":\nCannot find module 'utf-8-validate' loaded from .*\/node_modules\/ws\/lib\/validation\.js$/u,
  },
  {
    id: "Zsh integration asset",
    manifestPattern:
      /^packages\/server\/dist\/server\/terminal\/shell-integration\/zsh\/\.zshenv$/u,
    warningPattern:
      /^Failed to parse .*\/packages\/server\/dist\/server\/terminal\/shell-integration\/zsh\/\.zshenv as (?:module|script):\nUnexpected token \(\d+:\d+\)$/u,
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
    if (!manifest.some((entry) => policy.manifestPattern.test(entry))) {
      throw new RuntimeClosureError(`missing runtime compensation for ${policy.id}:\n${warning}`);
    }
  }

  for (const policy of WARNING_POLICIES) {
    if (!matchedPolicyIds.has(policy.id)) {
      throw new RuntimeClosureError(`missing trace warning for ${policy.id}`);
    }
  }
}

export { RuntimeClosureError, enforceTraceWarningPolicy, parseTraceWarnings };
