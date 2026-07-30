{
  lib,
  buildNpmPackage,
  fetchNpmDeps,
  jq,
  makeWrapper,
  nodejs-slim,
  packageLib,
}:
let
  package = packageLib.mkNpmCliPackage {
    inherit
      buildNpmPackage
      fetchNpmDeps
      jq
      makeWrapper
      ;

    nodejs = nodejs-slim;

    pname = "opencli";
    packageName = "@jackwener/opencli";
    tarballName = "opencli";
    cliPath = "dist/src/main.js";
    launcherNames = [ "opencli" ];
    installItems = [
      "LICENSE"
      "README.md"
      "README.zh-CN.md"
      "cli-manifest.json"
      "clis"
      "dist"
      "node_modules"
      "package.json"
      "skills"
    ];
    preVersionCheck = ''
      export HOME="$PWD/versionCheckHome"
      export XDG_CACHE_HOME="$PWD/versionCheckCache"
      export XDG_CONFIG_HOME="$PWD/versionCheckConfig"
      mkdir -p "$HOME" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME"
    '';
    versionCheckKeepEnvironment = [
      "HOME"
      "PATH"
      "XDG_CACHE_HOME"
      "XDG_CONFIG_HOME"
    ];
    installCheckExtra = ''
      installCheckHome="$PWD/installCheckHome"
      installCheckCache="$PWD/installCheckCache"
      installCheckConfig="$PWD/installCheckConfig"
      mkdir -p "$installCheckHome" "$installCheckCache" "$installCheckConfig"

      helpOutput="$(HOME="$installCheckHome" XDG_CACHE_HOME="$installCheckCache" XDG_CONFIG_HOME="$installCheckConfig" "$out/bin/opencli" --help)"
      case "$helpOutput" in
        *"opencli"*) ;;
        *) failCheck "unexpected opencli --help output" ;;
      esac

      HOME="$installCheckHome" XDG_CACHE_HOME="$installCheckCache" XDG_CONFIG_HOME="$installCheckConfig" \
        "$out/bin/opencli" list > /dev/null

      pluginDirectory="$installCheckHome/.opencli/plugins/nix-fixture"
      mkdir -p "$pluginDirectory"
      printf '%s\n' \
        "import { cli, Strategy } from 'file://$packageRoot/dist/src/registry-api.js';" \
        "cli({ site: 'nix-fixture', name: 'smoke', access: 'read', description: 'Nix plugin fixture', browser: false, strategy: Strategy.PUBLIC, args: [], columns: ['ok'], func: async () => ({ ok: true }) });" \
        > "$pluginDirectory/smoke.js"
      HOME="$installCheckHome" XDG_CACHE_HOME="$installCheckCache" XDG_CONFIG_HOME="$installCheckConfig" \
        AGENT_REACH_NIX_MANAGED=1 "$out/bin/opencli" list > plugin-output
      grep -q "Nix plugin fixture" plugin-output

      assertFileExists "$packageRoot/cli-manifest.json"
      assertFileExists "$packageRoot/clis/bilibili/search.js"
      assertFileExists "$packageRoot/skills/opencli-usage/SKILL.md"
    '';
    meta = {
      homepage = "https://github.com/jackwener/opencli";
      license = lib.licenses.asl20;
      description = "Turn websites and logged-in browser sessions into command-line interfaces";
    };
  };
in
package.overrideAttrs (oldAttrs: {
  patches = (oldAttrs.patches or [ ]) ++ [ ./patch/nixManagedProbe.patch ];
})
