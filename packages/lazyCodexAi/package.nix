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

    packageRoot="$out/libexec/lazycodex-ai"
    mkdir -p "$packageRoot" "$out/bin"
    cp -R . "$packageRoot/"
    rm -f "$packageRoot/.attrs.json" "$packageRoot/.attrs.sh" "$packageRoot/env-vars"
    find "$packageRoot/packages/omo-codex/plugin" -type d -name .github -prune -exec rm -rf {} +

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

    runLazyCodexInstallCheck 1
    runLazyCodexInstallCheck 2

    pluginRoot="$installCheckCodexHome/plugins/cache/sisyphuslabs/omo/${pin.version}"
    assertFileExists "$pluginRoot/.codex-plugin/plugin.json"
    assertFileExists "$pluginRoot/components/codegraph/dist/cli.js"
    assertFileExists "$installCheckCodexHome/config.toml"
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
