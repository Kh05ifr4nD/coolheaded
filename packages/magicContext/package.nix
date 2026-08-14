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

    assertFileExists "$packageRoot/dist/index.js"
    jq -e '.name == "@cortexkit/magic-context" and .bin["magic-context"] == "dist/index.js"' "$packageRoot/package.json" > /dev/null \
      || failCheck "unexpected magic-context package metadata"

    runMagicContext() {
      HOME="$installCheckHome" \
        TMPDIR="$installCheckTmp" \
        XDG_CACHE_HOME="$installCheckRoot/cache" \
        XDG_CONFIG_HOME="$installCheckRoot/config" \
        XDG_DATA_HOME="$installCheckRoot/data" \
        XDG_STATE_HOME="$installCheckRoot/state" \
        "$out/bin/magic-context" "$@"
    }

    helpOutput="$(runMagicContext --help 2>&1)"
    case "$helpOutput" in
      *"Magic Context CLI"*) ;;
      *) failCheck "unexpected magic-context --help output" ;;
    esac
    case "$helpOutput" in
      *"setup"*) ;;
      *) failCheck "magic-context --help is missing setup" ;;
    esac
    case "$helpOutput" in
      *"doctor"*) ;;
      *) failCheck "magic-context --help is missing doctor" ;;
    esac
    case "$helpOutput" in
      *"--harness omp"*) ;;
      *) failCheck "magic-context --help is missing --harness omp" ;;
    esac

    versionOutput="$(runMagicContext --version 2>&1)"
    test "$versionOutput" = "$packageVersion" || failCheck "unexpected magic-context --version output: $versionOutput"

    if invalidHarnessOutput="$(runMagicContext setup --harness unsupported 2>&1)"; then
      failCheck "magic-context accepted an invalid --harness value"
    fi
    case "$invalidHarnessOutput" in
      *"Invalid --harness value: unsupported (expected opencode, pi, or omp)"*) ;;
      *) failCheck "unexpected invalid --harness output" ;;
    esac

    repairDbHelpOutput="$(runMagicContext doctor repair-db --help 2>&1)"
    case "$repairDbHelpOutput" in
      *"Usage: magic-context doctor repair-db"*) ;;
      *) failCheck "unexpected magic-context doctor repair-db --help output" ;;
    esac
    case "$repairDbHelpOutput" in
      *"SQLite .recover"*) ;;
      *) failCheck "magic-context doctor repair-db --help is missing SQLite .recover" ;;
    esac
  '';
  meta = {
    homepage = "https://github.com/cortexkit/magic-context#readme";
    license = lib.licenses.mit;
    description = "Unbounded context and self-managing memory for coding agents";
  };
}
