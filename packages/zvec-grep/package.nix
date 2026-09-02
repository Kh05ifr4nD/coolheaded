{
  autoPatchelfHook,
  buildNpmPackage,
  fetchNpmDeps,
  jq,
  lib,
  makeWrapper,
  nodejs-slim,
  packageLib,
  stdenv,
}:
let
  inherit (stdenv.hostPlatform) system;

  platform =
    {
      aarch64-darwin = {
        llamaCpp = "mac-arm64-metal";
        ripgrep = "ripgrep-darwin-arm64";
        sharp = "sharp-darwin-arm64";
        sharpLibvips = "sharp-libvips-darwin-arm64";
        zvec = "bindings-darwin-arm64";
      };
      aarch64-linux = {
        llamaCpp = "linux-arm64";
        ripgrep = "ripgrep-linux-arm64";
        sharp = "sharp-linux-arm64";
        sharpLibvips = "sharp-libvips-linux-arm64";
        zvec = "bindings-linux-arm64";
      };
      x86_64-linux = {
        llamaCpp = "linux-x64";
        ripgrep = "ripgrep-linux-x64";
        sharp = "sharp-linux-x64";
        sharpLibvips = "sharp-libvips-linux-x64";
        zvec = "bindings-linux-x64";
      };
    }
    .${system} or (throw "Unsupported system for zvec-grep: ${system}");

  package = packageLib.mkNpmCliPackage {
    inherit
      buildNpmPackage
      fetchNpmDeps
      jq
      makeWrapper
      ;

    nodejs = nodejs-slim;

    pname = "zvec-grep";
    packageName = "@zvec/zvec-grep";
    tarballName = "zvec-grep";
    cliPath = "dist/cli/index.js";
    launcherNames = [ "zg" ];
    installItems = [
      "LICENSE"
      "README.md"
      "README_CN.md"
      "docs"
      "dist"
      "node_modules"
      "package.json"
    ];
    extraNativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
    preVersionCheck = ''
      export HOME="$PWD/versionCheckHome"
      export XDG_CACHE_HOME="$PWD/versionCheckCache"
      export XDG_CONFIG_HOME="$PWD/versionCheckConfig"
      export XDG_DATA_HOME="$PWD/versionCheckData"
      export XDG_STATE_HOME="$PWD/versionCheckState"
      mkdir -p "$HOME" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME"
    '';
    versionCheckKeepEnvironment = [
      "HOME"
      "PATH"
      "XDG_CACHE_HOME"
      "XDG_CONFIG_HOME"
      "XDG_DATA_HOME"
      "XDG_STATE_HOME"
    ];
    installCheckExtra = ''
      installCheckHome="$PWD/installCheckHome"
      installCheckRoot="$PWD/installCheckXdg"
      mkdir -p "$installCheckHome" "$installCheckRoot"/{cache,config,data,state}

      helpOutput="$(
        HOME="$installCheckHome" \
          XDG_CACHE_HOME="$installCheckRoot/cache" \
          XDG_CONFIG_HOME="$installCheckRoot/config" \
          XDG_DATA_HOME="$installCheckRoot/data" \
          XDG_STATE_HOME="$installCheckRoot/state" \
          "$out/bin/zg" --help 2>&1
      )"
      case "$helpOutput" in
        *"Usage:"*) ;;
        *) failCheck "unexpected zg --help output" ;;
      esac

      versionOutput="$(
        HOME="$installCheckHome" \
          XDG_CACHE_HOME="$installCheckRoot/cache" \
          XDG_CONFIG_HOME="$installCheckRoot/config" \
          XDG_DATA_HOME="$installCheckRoot/data" \
          XDG_STATE_HOME="$installCheckRoot/state" \
          "$out/bin/zg" version
      )"
      test "$versionOutput" = "$packageVersion"

      HOME="$installCheckHome" \
        XDG_CACHE_HOME="$installCheckRoot/cache" \
        XDG_CONFIG_HOME="$installCheckRoot/config" \
        XDG_DATA_HOME="$installCheckRoot/data" \
        XDG_STATE_HOME="$installCheckRoot/state" \
        "$out/bin/zg" status > /dev/null
    '';
    meta = {
      homepage = "https://github.com/zvec-ai/zvec-grep";
      license = lib.licenses.asl20;
      description = "Local-first search across your workspace, built for humans and AI agents";
    };
  };
in
package.overrideAttrs (oldAttrs: {
  buildInputs =
    (oldAttrs.buildInputs or [ ]) ++ lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];
  env = (oldAttrs.env or { }) // {
    ONNXRUNTIME_NODE_INSTALL_CUDA = "skip";
  };
  postInstall = (oldAttrs.postInstall or "") + ''
    . ${../../lib/package.sh}

    packageRoot="$out/libexec/zvec-grep"
    keepOnlyMatchingChildren "$packageRoot/node_modules/@img" "sharp-" \
      "${platform.sharp}" "${platform.sharpLibvips}"
    keepOnlyMatchingChildren "$packageRoot/node_modules/@node-llama-cpp" "" \
      "${platform.llamaCpp}"
    keepOnlyMatchingChildren "$packageRoot/node_modules/@vscode" "ripgrep-" \
      "${platform.ripgrep}"
    keepOnlyMatchingChildren "$packageRoot/node_modules/@zvec" "bindings-" \
      "${platform.zvec}"
  '';
  meta = oldAttrs.meta // {
    sourceProvenance = with lib.sourceTypes; [
      fromSource
      binaryNativeCode
    ];
  };
})
