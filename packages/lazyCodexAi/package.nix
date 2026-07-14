{
  lib,
  stdenv,
  autoPatchelfHook,
  coolheaded,
  makeWrapper,
  nodejs,
  packageLib,
}:
let
  pname = "lazycodex-ai";
  pin = builtins.fromJSON (builtins.readFile ./pin.json);

  platformMap = {
    aarch64-darwin = {
      biome = "cli-darwin-arm64";
      commentChecker = "darwin-arm64";
      lightningcss = "lightningcss-darwin-arm64";
      rolldown = "binding-darwin-arm64";
    };
    aarch64-linux = {
      biome = "cli-linux-arm64";
      commentChecker = "linux-arm64";
      lightningcss = "lightningcss-linux-arm64-gnu";
      rolldown = "binding-linux-arm64-gnu";
    };
    x86_64-linux = {
      biome = "cli-linux-x64";
      commentChecker = "linux-x64";
      lightningcss = "lightningcss-linux-x64-gnu";
      rolldown = "binding-linux-x64-gnu";
    };
  };
  platform = packageLib.releaseTarget pname platformMap;

  packageName = "lazycodex-ai";
  packageRoot = "${placeholder "out"}/libexec/lazycodex-ai";
  codeGraphExecutable = "${coolheaded.codeGraph}/bin/codegraph";
  nodeExecutable = "${nodejs}/bin/node";
  nodePath = lib.makeBinPath [ nodejs ];
in
packageLib.mkNpmTarballPackage {
  inherit pname;
  inherit packageName;
  changelog =
    { version, ... }: "https://github.com/code-yeongyu/oh-my-openagent/releases/tag/v${version}";

  nativeBuildInputs = [
    makeWrapper
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src" --strip-components=1
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall

    . ${../../lib/package.sh}

    patch -p1 < ${./patch/normalizeCopiedPluginCachePermissions.patch}
    patch -p1 < ${./patch/useBundledCleanupCli.patch}

    packageRoot="$out/libexec/lazycodex-ai"
    mkdir -p "$packageRoot" "$out/bin"
    cp -R . "$packageRoot/"
    rm -f \
      "$packageRoot/.attrs.json" \
      "$packageRoot/.attrs.sh" \
      "$packageRoot/env-vars" \
      "$packageRoot/packages/omo-codex/scripts/install-dist/install-local.mjs.orig"

    find "$packageRoot/packages/omo-codex/plugin" -type d -name .github -prune -exec rm -rf {} +

    LAZYCODEX_PACKAGE_ROOT="$packageRoot" \
      "${nodeExecutable}" ${./script/pruneOmoGitBash.mjs}

    LAZYCODEX_PACKAGE_ROOT="$packageRoot" \
      "${nodeExecutable}" ${./script/hardenOmoCodexRuntime.mjs}

    pluginRoot="$packageRoot/packages/omo-codex/plugin"
    rm -rf \
      "$packageRoot/packages/git-bash-mcp" \
      "$packageRoot/dist/cli/install-codex/git-bash.d.ts" \
      "$pluginRoot/components/git-bash" \
      "$pluginRoot/components/rules/bundled-rules/windows-git-bash.md" \
      "$pluginRoot/components/rules/test/windows-git-bash-bundled-rule.test.ts" \
      "$pluginRoot/hooks/post-compact-resetting-git-bash-mcp-reminder.json" \
      "$pluginRoot/hooks/pre-tool-use-recommending-git-bash-mcp.json"

    LAZYCODEX_PLUGIN_ROOT="$packageRoot/packages/omo-codex/plugin" \
    LAZYCODEX_NODE_EXECUTABLE="${nodeExecutable}" \
    LAZYCODEX_CODEGRAPH_EXECUTABLE="${codeGraphExecutable}" \
      "${nodeExecutable}" ${./script/rewriteOmoPluginRuntimeJson.mjs}

    pluginNodeModules="$packageRoot/packages/omo-codex/plugin/node_modules"
    keepOnlyMatchingChildren "$pluginNodeModules/@biomejs" "cli-" '${platform.biome}'
    keepOnlyMatchingChildren "$pluginNodeModules/@rolldown" "binding-" '${platform.rolldown}'
    keepOnlyMatchingChildren "$pluginNodeModules" "lightningcss-" '${platform.lightningcss}'
    keepOnlyMatchingChildren "$pluginNodeModules/@code-yeongyu/comment-checker/vendor" "" '${platform.commentChecker}'
    rm -rf "$pluginNodeModules/@colbymchenry/codegraph" "$pluginNodeModules/@colbymchenry/codegraph-"*
    rmdir "$pluginNodeModules/@colbymchenry" 2> /dev/null || true
    makeWrapper "${nodejs}/bin/node" "$out/bin/lazycodex-ai" \
      --add-flags "$packageRoot/packages/omo-codex/scripts/install-local.mjs" \
      --set-default LAZYCODEX_AI_NIX_SKIP_CACHE_NPM 1 \
      --set LAZYCODEX_AI_NIX_OMO_CLI "$packageRoot/dist/cli-node/index.js" \
      --prefix PATH : "${nodePath}"

    runHook postInstall
  '';

  versionCheckProgram = "${placeholder "out"}/bin/lazycodex-ai";
  installCheck.extra = ''
    helpOutput="$("$out/bin/lazycodex-ai" --help 2>&1)"
    case "$helpOutput" in
      *"Usage: lazycodex-ai install"*) ;;
      *) failCheck "unexpected lazycodex-ai --help output" ;;
    esac

    dryRunOutput="$("$out/bin/lazycodex-ai" --dry-run 2>&1)"
    case "$dryRunOutput" in
      *"oh-my-openagent@latest install --platform=codex"*) ;;
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
    assertFileExists "$pluginRoot/components/codegraph/dist/cli.js"
    assertFileExists "$installCheckCodexHome/config.toml"
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

    assertFileExists "${codeGraphExecutable}"
    grep -F "\"command\": \"${nodeExecutable}\"" "$pluginRoot/.mcp.json" > /dev/null \
      || failCheck "installed OMO MCP manifest does not use packaged node"
    grep -F "\"OMO_CODEGRAPH_BIN\": \"${codeGraphExecutable}\"" "$pluginRoot/.mcp.json" > /dev/null \
      || failCheck "installed OMO MCP manifest does not use packaged codegraph"
    bundledCodeGraphPackage="$(find "$pluginRoot/node_modules/@colbymchenry" \
      -mindepth 1 -maxdepth 1 -name 'codegraph*' -print -quit 2> /dev/null || true)"
    test -z "$bundledCodeGraphPackage" \
      || failCheck "installed OMO plugin contains bundled npm codegraph package: $bundledCodeGraphPackage"
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
  '';

  meta = {
    homepage = "https://www.npmjs.com/package/lazycodex-ai";
    license = lib.licenses.unfree;
    description = "Coding agent for tokenmaxxers";
  };
}
