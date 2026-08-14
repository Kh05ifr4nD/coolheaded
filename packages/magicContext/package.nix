{
  lib,
  buildNpmPackage,
  fetchNpmDeps,
  jq,
  makeWrapper,
  nodejs-slim,
  packageLib,
}:
packageLib.mkNpmCliPackage {
  inherit
    buildNpmPackage
    fetchNpmDeps
    jq
    makeWrapper
    ;

  nodejs = nodejs-slim;

  pname = "magic-context";
  packageName = "@cortexkit/magic-context";
  cliPath = "dist/index.js";
  launcherNames = [ "magic-context" ];
  installItems = [
    "dist"
    "node_modules"
    "package.json"
  ];
  preVersionCheck = ''
    export HOME="$PWD/versionCheckHome"
    export XDG_CACHE_HOME="$PWD/versionCheckCache"
    export XDG_CONFIG_HOME="$PWD/versionCheckConfig"
    export XDG_DATA_HOME="$PWD/versionCheckData"
    export XDG_STATE_HOME="$PWD/versionCheckState"
    export TMPDIR="$PWD/versionCheckTmp"
    mkdir -p "$HOME" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$TMPDIR"
  '';
  versionCheckKeepEnvironment = [
    "HOME"
    "PATH"
    "TMPDIR"
    "XDG_CACHE_HOME"
    "XDG_CONFIG_HOME"
    "XDG_DATA_HOME"
    "XDG_STATE_HOME"
  ];
  installCheckExtra = ''
    installCheckHome="$PWD/installCheckHome"
    installCheckRoot="$PWD/installCheckXdg"
    installCheckTmp="$PWD/installCheckTmp"
    mkdir -p "$installCheckHome" "$installCheckRoot/cache" "$installCheckRoot/config" "$installCheckRoot/data" "$installCheckRoot/state" "$installCheckTmp"

    helpOutput="$(HOME="$installCheckHome" TMPDIR="$installCheckTmp" XDG_CACHE_HOME="$installCheckRoot/cache" XDG_CONFIG_HOME="$installCheckRoot/config" XDG_DATA_HOME="$installCheckRoot/data" XDG_STATE_HOME="$installCheckRoot/state" "$out/bin/magic-context" --help 2>&1)"
    case "$helpOutput" in
      *"Magic Context CLI"*) ;;
      *) failCheck "unexpected magic-context --help output" ;;
    esac

    versionOutput="$(HOME="$installCheckHome" TMPDIR="$installCheckTmp" XDG_CACHE_HOME="$installCheckRoot/cache" XDG_CONFIG_HOME="$installCheckRoot/config" XDG_DATA_HOME="$installCheckRoot/data" XDG_STATE_HOME="$installCheckRoot/state" "$out/bin/magic-context" --version 2>&1)"
    test "$versionOutput" = "$packageVersion" || failCheck "unexpected magic-context --version output: $versionOutput"
  '';
  meta = {
    homepage = "https://github.com/cortexkit/magic-context#readme";
    license = lib.licenses.mit;
    description = "Unified CLI for Magic Context — setup, doctor, and migration across OpenCode, Pi, and OMP";
  };
}
