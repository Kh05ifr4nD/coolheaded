# LazyCodex for Codex

The source is the `lazycodex-ai` npm tarball, pinned by version and SRI hash.
It contains the Codex installer, plugin, shared skills, and compiled component
runtimes. The standalone Senpi client and OpenCode plugin are separate products.

## Runtime contract

- `packages/omo-codex/scripts/install-dist/install-local.mjs` installs the plugin.
- `dist/cli-node/index.js` handles delegated commands from the same release.
- `packages/omo-codex/plugin/` supplies manifests, hooks, agents, and skills.
- `packages/lsp-daemon/dist/` supplies the bundled LSP MCP entrypoint.
- `commentChecker.json` pins the native Comment Checker from the plugin's npm
  lock file; the update script refreshes both pins together.

The package uses the compiled runtimes without running npm in the installed
cache. Node and ast-grep paths are fixed to Nix store executables. Only the
current platform's Comment Checker binary is retained. Windows Git Bash
integration is removed on the supported Darwin and Linux systems.

The installer normalizes copied store permissions before rewriting caches.
Cleanup is restricted to managed OMO state, preserves unrelated plugins and
configuration, and refuses symlink traversal. Runtime transformations validate
their expected inputs so upstream layout changes fail the build.

The SessionStart self-update hook is omitted. `lazycodex-ai update` directs the
user to update the flake input and rebuild; delegated commands use bundled code.

## Checks

`installCheck.nix` exercises offline installation from read-only sources,
reinstallation, native Comment Checker startup, hook paths, LSP MCP
initialization and tool discovery, cleanup, and symlink boundaries.
`check.nix` exercises Home Manager activation, settings precedence, idempotence,
damaged-cache repair, disable cleanup, and failed-activation cleanup.
