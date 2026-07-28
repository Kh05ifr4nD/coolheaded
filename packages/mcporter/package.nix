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
    nodejs-slim
    ;

  pname = "mcporter";
  cliPath = "dist/cli.js";
  launcherNames = [ "mcporter" ];
  installItems = [
    "LICENSE"
    "README.md"
    "dist"
    "node_modules"
    "package.json"
  ];
  preVersionCheck = ''
    export HOME="$PWD/versionCheckHome"
    export MCPORTER_CONFIG="$PWD/versionCheckConfig/mcporter.json"
    export XDG_CACHE_HOME="$PWD/versionCheckCache"
    export XDG_CONFIG_HOME="$PWD/versionCheckConfig"
    export XDG_DATA_HOME="$PWD/versionCheckData"
    export XDG_STATE_HOME="$PWD/versionCheckState"
    mkdir -p "$HOME" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME"
    echo '{"mcpServers":{}}' > "$MCPORTER_CONFIG"
  '';
  versionCheckKeepEnvironment = [
    "HOME"
    "MCPORTER_CONFIG"
    "PATH"
    "XDG_CACHE_HOME"
    "XDG_CONFIG_HOME"
    "XDG_DATA_HOME"
    "XDG_STATE_HOME"
  ];
  installCheckExtra = ''
    installCheckHome="$PWD/installCheckHome"
    installCheckRoot="$PWD/installCheckXdg"
    installCheckConfig="$installCheckRoot/config/mcporter.json"
    mkdir -p "$installCheckHome" "$installCheckRoot/config" "$installCheckRoot/cache" "$installCheckRoot/data" "$installCheckRoot/state"
    echo '{"mcpServers":{}}' > "$installCheckConfig"

    helpOutput="$(HOME="$installCheckHome" MCPORTER_CONFIG="$installCheckConfig" XDG_CACHE_HOME="$installCheckRoot/cache" XDG_CONFIG_HOME="$installCheckRoot/config" XDG_DATA_HOME="$installCheckRoot/data" XDG_STATE_HOME="$installCheckRoot/state" "$out/bin/mcporter" --help 2>&1)"
    case "$helpOutput" in
      *"mcporter"*) ;;
      *) failCheck "unexpected mcporter --help output" ;;
    esac

    configOutput="$(HOME="$installCheckHome" MCPORTER_CONFIG="$installCheckConfig" XDG_CACHE_HOME="$installCheckRoot/cache" XDG_CONFIG_HOME="$installCheckRoot/config" XDG_DATA_HOME="$installCheckRoot/data" XDG_STATE_HOME="$installCheckRoot/state" "$out/bin/mcporter" config list --json)"
    case "$configOutput" in
      *'"servers"'*) ;;
      *) failCheck "unexpected mcporter config list --json output" ;;
    esac
  '';
  meta = {
    homepage = "https://github.com/openclaw/mcporter";
    license = lib.licenses.mit;
    description = "Call Model Context Protocol servers from the command line";
  };
}
