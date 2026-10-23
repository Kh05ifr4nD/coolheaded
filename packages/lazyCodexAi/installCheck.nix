{
  commentCheckerPin,
  nodeExecutable,
  packageRoot,
  pin,
}:
''
  export NPM_CONFIG_OFFLINE=true
  export NPM_CONFIG_REGISTRY=http://127.0.0.1:9
  helpOutput="$("$out/bin/lazycodex-ai" --help 2>&1)"
  case "$helpOutput" in
    *"Usage: lazycodex-ai install"*) ;;
    *) failCheck "unexpected lazycodex-ai --help output" ;;
  esac

  dryRunOutput="$("$out/bin/lazycodex-ai" --dry-run 2>&1)"
  case "$dryRunOutput" in
    *"${packageRoot}/dist/cli-node/index.js install --platform=codex"*) ;;
    *) failCheck "unexpected lazycodex-ai --dry-run output" ;;
  esac

  dryRunUninstallOutput="$("$out/bin/lazycodex-ai" --dry-run uninstall 2>&1)"
  case "$dryRunUninstallOutput" in
    *"${packageRoot}/dist/cli-node/index.js cleanup --platform=codex"*) ;;
    *) failCheck "lazycodex-ai uninstall does not use its bundled same-version cleanup CLI" ;;
  esac

  test ! -e "$packageRoot/packages/git-bash-mcp" \
    || failCheck "packaged LazyCodex contains the Windows-only Git Bash MCP"
  test ! -e "$packageRoot/packages/omo-codex/plugin/components/git-bash" \
    || failCheck "packaged OMO plugin contains the Windows-only Git Bash component"
  test ! -e "$packageRoot/packages/omo-codex/plugin/components/rules/bundled-rules/windows-git-bash.md" \
    || failCheck "packaged OMO plugin contains the Windows-only Git Bash rule"
  for gitBashMetadata in \
    "$packageRoot/package.json" \
    "$packageRoot/packages/omo-codex/plugin/package.json" \
    "$packageRoot/packages/omo-codex/plugin/package-lock.json" \
    "$packageRoot/packages/omo-codex/plugin/.mcp.json" \
    "$packageRoot/packages/omo-codex/plugin/.codex-plugin/plugin.json"; do
    if grep -Eiq 'git[-_]bash|Git Bash' "$gitBashMetadata"; then
      failCheck "packaged metadata still references Git Bash: $gitBashMetadata"
    fi
  done
  for gitBashConfigWriter in \
    "$packageRoot/dist/cli-node/index.js" \
    "$packageRoot/dist/cli/index.js" \
    "$packageRoot/packages/omo-codex/scripts/install-dist/install-local.mjs" \
    "$packageRoot/packages/omo-codex/plugin/components/bootstrap/dist/cli.js"; do
    if grep -Eq 'ensurePluginMcpEnabled\([^)]*"git_bash"' "$gitBashConfigWriter"; then
      failCheck "packaged runtime still exposes Git Bash config: $gitBashConfigWriter"
    fi
    grep -F 'nextConfig = removeGitBashMcpConfig(nextConfig);' \
      "$gitBashConfigWriter" > /dev/null \
      || failCheck "packaged runtime does not clean stale Git Bash config: $gitBashConfigWriter"
  done

  installCheckHome="$PWD/installCheckHome"
  installCheckCodexHome="$PWD/installCheckCodexHome"
  installCheckTmp="$PWD/installCheckTmp"
  installOutput="$PWD/lazycodex-install.log"
  mkdir -p "$installCheckHome" "$installCheckCodexHome" "$installCheckTmp"

  chmod -R a-w "${packageRoot}/packages/omo-codex/plugin"

  runLazyCodexInstallCheck() {
    installAttempt="$1"
    if ! HOME="$installCheckHome" \
      CODEX_HOME="$installCheckCodexHome" \
      TMPDIR="$installCheckTmp" \
      OMO_CODEX_DISABLE_POSTHOG=1 \
      "$out/bin/lazycodex-ai" install --no-tui > "$installOutput" 2>&1; then
      sed -n '1,160p' "$installOutput" >&2
      failCheck "lazycodex-ai install attempt $installAttempt against a read-only packaged plugin source failed"
    fi
  }

  assertNoGitBashConfig() {
    if grep -Eiq 'git[-_]bash|Git Bash' "$installCheckCodexHome/config.toml"; then
      failCheck "installed Codex config still exposes Git Bash"
    fi
  }

  runLazyCodexInstallCheck 1
  printf '\n[plugins."omo@sisyphuslabs".mcp_servers.git_bash]\nenabled = true\n' \
    >> "$installCheckCodexHome/config.toml"
  runLazyCodexInstallCheck 2
  assertNoGitBashConfig

  printf "\n[plugins.'omo@sisyphuslabs'.mcp_servers.'git_bash']\nenabled = true\n" \
    >> "$installCheckCodexHome/config.toml"
  runLazyCodexInstallCheck 3
  assertNoGitBashConfig

  dottedConfig="$installCheckCodexHome/config.toml.dotted"
  printf "plugins.'omo@sisyphuslabs'.mcp_servers.git_bash.enabled = true\n" > "$dottedConfig"
  cat "$installCheckCodexHome/config.toml" >> "$dottedConfig"
  mv "$dottedConfig" "$installCheckCodexHome/config.toml"
  runLazyCodexInstallCheck 4
  assertNoGitBashConfig

  pluginRoot="$installCheckCodexHome/plugins/cache/sisyphuslabs/omo/${pin.version}"
  assertFileExists "$pluginRoot/.codex-plugin/plugin.json"
  assertFileExists "$installCheckCodexHome/config.toml"

  PLUGIN_ROOT="$pluginRoot" PACKAGE_ROOT="${packageRoot}" \
    "${nodeExecutable}" --input-type=module <<'NODE'
  import assert from "node:assert/strict";
  import { execFileSync, spawn } from "node:child_process";
  import { readFileSync } from "node:fs";
  import { once } from "node:events";
  import { pathToFileURL } from "node:url";
  const plugin = process.env.PLUGIN_ROOT;
  const root = process.env.PACKAGE_ROOT;
  process.env.LAZYCODEX_AI_NIX_SKIP_CACHE_NPM = "1";
  const installer = await import(pathToFileURL(root + "/packages/omo-codex/scripts/install-dist/install-local.mjs"));
  const sourceCommands = [];
  await assert.rejects(installer.installCachedPlugin({
    sourcePath: root + "/packages/omo-codex/plugin",
    codexHome: plugin,
    marketplaceName: "source-probe",
    name: "omo",
    version: "probe",
    buildSource: true,
    runCommand: async (command, args) => {
      sourceCommands.push([command, ...args]);
      if (args[0] === "run") throw new Error("source-build-probe");
    },
  }), /source-build-probe/);
  assert.deepEqual(sourceCommands, [["npm", "install"], ["npm", "run", "build"]]);
  const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
  const lock = readJson(root + "/packages/omo-codex/plugin/package-lock.json");
  const dependency = lock.packages["node_modules/@code-yeongyu/comment-checker"];
  assert.equal(dependency.version, ${builtins.toJSON commentCheckerPin.version});
  assert.equal(dependency.integrity, ${builtins.toJSON commentCheckerPin.packageHash});
  const help = execFileSync(root + "/runtime/comment-checker", ["--help"], { encoding: "utf8" });
  assert.match(help, /comment-checker/);
  const manifest = readJson(plugin + "/.codex-plugin/plugin.json");
  assert(!manifest.hooks.some((path) => path.includes("checking-auto-update")));
  for (const path of manifest.hooks) {
    const hook = readJson(plugin + "/" + path);
    for (const entries of Object.values(hook.hooks)) {
      for (const entry of entries) {
        for (const action of entry.hooks) {
          assert(action.command.includes(${builtins.toJSON nodeExecutable}));
          assert(action.command.includes("OMO_AST_GREP_SG_PATH="));
        }
      }
    }
  }
  const server = readJson(plugin + "/.mcp.json").mcpServers.lsp;
  const child = spawn(server.command, server.args, { cwd: server.cwd, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("LSP MCP timed out: " + stderr)), 15000);
      child.on("error", reject);
      child.on("exit", (code) => reject(new Error("LSP MCP exited " + code + ": " + stderr)));
      let buffer = "";
      const send = (value) => child.stdin.write(JSON.stringify(value) + "\n");
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const message = JSON.parse(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          if (message.id === 1) {
            assert(message.result.capabilities.tools);
            send({ jsonrpc: "2.0", method: "notifications/initialized" });
            send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
          }
          if (message.id === 2) {
            assert(message.result.tools.some((tool) => tool.name.includes("diagnostics")));
            resolve();
          }
        }
      });
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "nix-check", version: "1" },
      } });
    });
  } finally {
    clearTimeout(timer);
    const closed = once(child, "close");
    child.kill();
    await closed;
  }
  console.log("Comment Checker binary, hook runtime paths, and LSP MCP verified");
  NODE

  updateOutput="$("$out/bin/lazycodex-ai" update --dry-run)"
  case "$updateOutput" in
    *"managed by Nix"*) ;;
    *) failCheck "LazyCodex update bypasses Nix version management" ;;
  esac
  assertNoGitBashConfig
  test ! -e "$pluginRoot/components/git-bash" \
    || failCheck "installed OMO plugin contains the Windows-only Git Bash component"
  test ! -e "$pluginRoot/components/git-bash-mcp" \
    || failCheck "installed OMO plugin contains the Windows-only Git Bash MCP"
  test ! -e "$installCheckCodexHome/bin/omo-git-bash-hook" \
    || failCheck "installed Codex bin directory contains the Windows-only Git Bash hook"
  if grep -Eiq 'git[-_]bash|Git Bash' "$pluginRoot/.mcp.json"; then
    failCheck "installed OMO MCP manifest still references Git Bash"
  fi
  if grep -Eiq 'git[-_]bash|Git Bash' "$pluginRoot/.codex-plugin/plugin.json"; then
    failCheck "installed OMO plugin manifest still references Git Bash"
  fi
  test -w "$pluginRoot/.codex-plugin" \
    || failCheck "installed plugin manifest directory is not writable"
  test -w "$pluginRoot/components/lsp-daemon/dist" \
    || failCheck "installed runtime dist directory is not writable"
  staleTmp="$(find "$installCheckCodexHome/plugins/cache/sisyphuslabs/omo" \
    -mindepth 1 -maxdepth 1 -name '.tmp-*' -print -quit)"
  test -z "$staleTmp" || failCheck "left stale plugin temp directory: $staleTmp"

  grep -F "\"command\": \"${nodeExecutable}\"" "$pluginRoot/.mcp.json" > /dev/null \
    || failCheck "installed OMO MCP manifest does not use packaged node"
  bareNodeCommand="$(grep -R '"command": "node' "$pluginRoot" --include '*.json' | head -1 || true)"
  test -z "$bareNodeCommand" || failCheck "installed OMO plugin contains bare node command: $bareNodeCommand"
  grep -F '[hooks.state.' "$installCheckCodexHome/config.toml" > /dev/null \
    || failCheck "installed config contains no trusted hook state"

  printf '\n[projects."/preserved-by-uninstall"]\ntrust_level = "trusted"\n' \
    >> "$installCheckCodexHome/config.toml"
  printf '\n[plugins."other@sisyphuslabs"]\nenabled = true\n' \
    >> "$installCheckCodexHome/config.toml"
  mkdir -p \
    "$installCheckCodexHome/plugins/cache/sisyphuslabs/other" \
    "$installCheckCodexHome/.tmp/marketplaces/sisyphuslabs/plugins/other"
  touch \
    "$installCheckCodexHome/plugins/cache/sisyphuslabs/other/sentinel" \
    "$installCheckCodexHome/.tmp/marketplaces/sisyphuslabs/plugins/other/sentinel"
  printf 'user owned\n' > "$installCheckCodexHome/agents/user-owned.toml"
  uninstallOutput="$PWD/lazycodex-uninstall.log"
  npmOfflineCache="$PWD/npmOfflineCache"
  mkdir -p "$npmOfflineCache"
  if ! HOME="$installCheckHome" \
    CODEX_HOME="$installCheckCodexHome" \
    TMPDIR="$installCheckTmp" \
    NPM_CONFIG_CACHE="$npmOfflineCache" \
    NPM_CONFIG_OFFLINE=true \
    NPM_CONFIG_REGISTRY=http://127.0.0.1:9 \
    OMO_CODEX_DISABLE_POSTHOG=1 \
    "$out/bin/lazycodex-ai" uninstall --json > "$uninstallOutput" 2>&1; then
    sed -n '1,160p' "$uninstallOutput" >&2
    failCheck "lazycodex-ai uninstall failed without npm registry access"
  fi
  grep -F '"configChanged": true' "$uninstallOutput" > /dev/null \
    || failCheck "lazycodex-ai uninstall did not report a config change"
  test ! -e "$installCheckCodexHome/plugins/cache/sisyphuslabs/omo" \
    || failCheck "lazycodex-ai uninstall left the managed OMO plugin cache"
  test -e "$installCheckCodexHome/plugins/cache/sisyphuslabs/other/sentinel" \
    || failCheck "lazycodex-ai uninstall removed another Sisyphus Labs plugin cache"
  test -e "$installCheckCodexHome/.tmp/marketplaces/sisyphuslabs/plugins/other/sentinel" \
    || failCheck "lazycodex-ai uninstall removed another Sisyphus Labs marketplace plugin"
  test ! -e "$installCheckCodexHome/agents/explorer.toml" \
    || failCheck "lazycodex-ai uninstall left a manifest-managed agent"
  test -e "$installCheckCodexHome/agents/user-owned.toml" \
    || failCheck "lazycodex-ai uninstall removed an agent absent from its manifest"
  grep -F '[projects."/preserved-by-uninstall"]' "$installCheckCodexHome/config.toml" > /dev/null \
    || failCheck "lazycodex-ai uninstall removed user-owned Codex config"
  grep -F '[plugins."other@sisyphuslabs"]' "$installCheckCodexHome/config.toml" > /dev/null \
    || failCheck "lazycodex-ai uninstall removed another Sisyphus Labs plugin config"
  configBackups=("$installCheckCodexHome"/config.toml.backup-*)
  test -e "''${configBackups[0]}" \
    || failCheck "lazycodex-ai uninstall did not back up the Codex config"
  test "$(stat -c '%a' "''${configBackups[0]}")" = 600 \
    || failCheck "lazycodex-ai uninstall created a world-readable Codex config backup"

  cleanupOutput="$PWD/lazycodex-cleanup.log"
  HOME="$installCheckHome" \
    CODEX_HOME="$installCheckCodexHome" \
    TMPDIR="$installCheckTmp" \
    NPM_CONFIG_CACHE="$npmOfflineCache" \
    NPM_CONFIG_OFFLINE=true \
    NPM_CONFIG_REGISTRY=http://127.0.0.1:9 \
    OMO_CODEX_DISABLE_POSTHOG=1 \
    "$out/bin/lazycodex-ai" cleanup --json > "$cleanupOutput" 2>&1
  grep -F '"configChanged": false' "$cleanupOutput" > /dev/null \
    || failCheck "lazycodex-ai cleanup alias is not idempotent after uninstall"

  symlinkCodexHome="$PWD/symlinkCodexHome"
  symlinkVictim="$PWD/symlinkVictim"
  mkdir -p "$symlinkCodexHome" "$symlinkVictim/cache/sisyphuslabs/omo"
  touch "$symlinkVictim/cache/sisyphuslabs/omo/sentinel"
  ln -s "$symlinkVictim" "$symlinkCodexHome/plugins"
  if HOME="$installCheckHome" \
    CODEX_HOME="$symlinkCodexHome" \
    TMPDIR="$installCheckTmp" \
    OMO_CODEX_DISABLE_POSTHOG=1 \
    "$out/bin/lazycodex-ai" install --no-tui > "$PWD/symlink-install.log" 2>&1; then
    failCheck "lazycodex-ai install accepted a symlinked plugin cache path"
  fi
  test ! -e "$symlinkVictim/cache/sisyphuslabs/omo/${pin.version}" \
    || failCheck "lazycodex-ai install wrote through an intermediate symlink outside CODEX_HOME"
  HOME="$installCheckHome" \
    CODEX_HOME="$symlinkCodexHome" \
    TMPDIR="$installCheckTmp" \
    OMO_CODEX_PROJECT="$installCheckTmp" \
    OMO_CODEX_DISABLE_POSTHOG=1 \
    "$out/bin/lazycodex-ai" uninstall --json > "$PWD/symlink-uninstall.log" 2>&1
  test -e "$symlinkVictim/cache/sisyphuslabs/omo/sentinel" \
    || failCheck "lazycodex-ai uninstall followed an intermediate symlink outside CODEX_HOME"

  configSymlinkCodexHome="$PWD/configSymlinkCodexHome"
  configSymlinkVictim="$PWD/configSymlinkVictim.toml"
  mkdir -p "$configSymlinkCodexHome"
  printf '[plugins."omo@sisyphuslabs"]\nenabled = true\n' > "$configSymlinkVictim"
  configSymlinkVictimHash="$(sha256sum "$configSymlinkVictim")"
  ln -s "$configSymlinkVictim" "$configSymlinkCodexHome/config.toml"
  if HOME="$installCheckHome" \
    CODEX_HOME="$configSymlinkCodexHome" \
    TMPDIR="$installCheckTmp" \
    OMO_CODEX_DISABLE_POSTHOG=1 \
    "$out/bin/lazycodex-ai" install --no-tui > "$PWD/config-symlink-install.log" 2>&1; then
    failCheck "lazycodex-ai install accepted a symlinked Codex config"
  fi
  test "$(sha256sum "$configSymlinkVictim")" = "$configSymlinkVictimHash" \
    || failCheck "lazycodex-ai install modified a symlink target outside CODEX_HOME"
  if HOME="$installCheckHome" \
    CODEX_HOME="$configSymlinkCodexHome" \
    TMPDIR="$installCheckTmp" \
    OMO_CODEX_PROJECT="$installCheckTmp" \
    OMO_CODEX_DISABLE_POSTHOG=1 \
    "$out/bin/lazycodex-ai" uninstall --json > "$PWD/config-symlink-uninstall.log" 2>&1; then
    failCheck "lazycodex-ai uninstall accepted a symlinked Codex config"
  fi
  test "$(sha256sum "$configSymlinkVictim")" = "$configSymlinkVictimHash" \
    || failCheck "lazycodex-ai uninstall modified a symlink target outside CODEX_HOME"

  test ! -e "$out/bin/lazycodex" || failCheck "unexpected lazycodex compatibility launcher"
  assertFileExists "${packageRoot}/packages/omo-codex/marketplace.json"
  assertFileExists "${packageRoot}/packages/omo-codex/scripts/install-local.mjs"
''
