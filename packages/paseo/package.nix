{
  autoPatchelfHook,
  buildNpmPackage,
  fetchNpmDeps,
  git,
  jq,
  lib,
  makeWrapper,
  nodejs-slim,
  packageLib,
  stdenv,
}:
let
  inherit (stdenv.hostPlatform) system;
  pin = builtins.fromJSON (builtins.readFile ./pin.json);

  platform =
    {
      aarch64-darwin = {
        claudeAgentSdk = "darwin-arm64";
        esbuild = "darwin-arm64";
        nodePty = "darwin-arm64";
        sherpa = "darwin-arm64";
      };
      aarch64-linux = {
        claudeAgentSdk = "linux-arm64";
        esbuild = "linux-arm64";
        nodePty = "linux-arm64";
        sherpa = "linux-arm64";
      };
      x86_64-linux = {
        claudeAgentSdk = "linux-x64";
        esbuild = "linux-x64";
        nodePty = "linux-x64";
        sherpa = "linux-x64";
      };
    }
    .${system} or (throw "Unsupported system for paseo: ${system}");

  package = packageLib.mkNpmCliPackage {
    inherit
      buildNpmPackage
      fetchNpmDeps
      jq
      makeWrapper
      ;

    nodejs = nodejs-slim;

    pname = "paseo";
    packageName = "@getpaseo/cli";
    tarballName = "cli";
    cliPath = "dist/index.js";
    launcherNames = [
      "paseo"
      "paseo-server"
    ];
    installItems = [
      "bin"
      "dist"
      "node_modules"
      "package.json"
    ];
    runtimeInputs = [
      git
      nodejs-slim
    ];
    extraNativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
    installCheckExtra = ''
      . ${../../lib/package.sh}
      packageRoot="$out/libexec/paseo"

      installCheckHome="$PWD/installCheckHome"
      installCheckRoot="$PWD/installCheckXdg"
      mkdir -p "$installCheckHome" "$installCheckRoot"/{cache,config,data,state}

      helpOutput="$(HOME="$installCheckHome" XDG_CACHE_HOME="$installCheckRoot/cache" XDG_CONFIG_HOME="$installCheckRoot/config" XDG_DATA_HOME="$installCheckRoot/data" XDG_STATE_HOME="$installCheckRoot/state" "$out/bin/paseo" --help 2>&1)"
      case "$helpOutput" in
        *"Paseo CLI - control your AI coding agents"*) ;;
        *) failCheck "unexpected paseo --help output" ;;
      esac

      daemonHelpOutput="$(HOME="$installCheckHome" XDG_CACHE_HOME="$installCheckRoot/cache" XDG_CONFIG_HOME="$installCheckRoot/config" XDG_DATA_HOME="$installCheckRoot/data" XDG_STATE_HOME="$installCheckRoot/state" "$out/bin/paseo" daemon --help 2>&1)"
      case "$daemonHelpOutput" in
        *"Manage the Paseo daemon"*) ;;
        *) failCheck "unexpected paseo daemon --help output" ;;
      esac

      assertFileExists "$packageRoot/package.json"
      assertFileExists "$packageRoot/dist/index.js"
      assertFileExists "$packageRoot/node_modules/@getpaseo/server/dist/scripts/supervisor-entrypoint.js"
      assertFileExists "$packageRoot/node_modules/@getpaseo/server/dist/server/server/daemon-worker.js"
      assertFileExists "$packageRoot/node_modules/@getpaseo/server/dist/server/terminal/terminal-worker-process.js"
      assertFileExists "$packageRoot/node_modules/@getpaseo/server/dist/server/web-ui/index.html"
      assertFileExists "$packageRoot/node_modules/@getpaseo/server/dist/server/server/speech/providers/local/sherpa/assets/silero_vad.onnx"

      test -d "$packageRoot/node_modules/@anthropic-ai/claude-agent-sdk-${platform.claudeAgentSdk}" \
        || failCheck "missing Claude Agent SDK platform package"
      test -d "$packageRoot/node_modules/@esbuild/${platform.esbuild}" \
        || failCheck "missing esbuild platform package"
      test -d "$packageRoot/node_modules/sherpa-onnx-${platform.sherpa}" \
        || failCheck "missing Sherpa ONNX platform package"
      ptyBinary="$(find "$packageRoot/node_modules/node-pty/prebuilds/${platform.nodePty}" -type f -name pty.node -print -quit)"
      [ -n "$ptyBinary" ] || failCheck "missing node-pty native addon"
    '';
    meta = {
      homepage = "https://github.com/getpaseo/paseo";
      license = lib.licenses.asl20;
      changelog = "https://github.com/getpaseo/paseo/releases/tag/v${pin.version}";
      description = "Orchestrate multiple coding agents from desktop and mobile";
    };
  };
in
package.overrideAttrs (oldAttrs: {
  buildInputs =
    (oldAttrs.buildInputs or [ ]) ++ lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];
  postInstall = (oldAttrs.postInstall or "") + ''
    packageRoot="$out/libexec/paseo"

    makeWrapper ${nodejs-slim}/bin/node "$out/bin/paseo-server" \
      --add-flags "$packageRoot/node_modules/@getpaseo/server/dist/scripts/supervisor-entrypoint.js" \
      --set PASEO_NODE_ENV production \
      --prefix PATH : "${
        lib.makeBinPath [
          git
          nodejs-slim
        ]
      }"

    . ${../../lib/package.sh}
    keepOnlyMatchingChildren "$packageRoot/node_modules/@anthropic-ai" "claude-agent-sdk-" \
      "claude-agent-sdk-${platform.claudeAgentSdk}"
    keepOnlyMatchingChildren "$packageRoot/node_modules/@esbuild" "" \
      "${platform.esbuild}"
    keepOnlyMatchingChildren "$packageRoot/node_modules" "sherpa-onnx-" \
      "sherpa-onnx-node" "sherpa-onnx-${platform.sherpa}"
    keepOnlyMatchingChildren "$packageRoot/node_modules/node-pty/prebuilds" "" \
      "${platform.nodePty}"
  '';
  meta = oldAttrs.meta // {
    mainProgram = "paseo";
    platforms = packageLib.supportedSystems;
    sourceProvenance = with lib.sourceTypes; [
      fromSource
      binaryNativeCode
    ];
  };
})
