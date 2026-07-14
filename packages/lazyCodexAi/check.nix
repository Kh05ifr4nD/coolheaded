{
  lib,
  package,
  packages,
  pkgs,
  ...
}:

let
  system = pkgs.stdenv.hostPlatform.system;
  testHome = "/tmp/lazycodex-ai-home-module-${
    builtins.substring 0 12 (builtins.hashString "sha256" package.outPath)
  }";
  codexHome = "${testHome}/.config/codex";
  statePackage = "state/lazycodex-ai-package";

  lazyCodexAiModule = import ../../homeModules/lazyCodexAi.nix {
    self.packages.${system} = {
      codex = packages.codex;
      lazyCodexAi = package;
    };
  };
  codexModule = import ../../homeModules/codex.nix {
    self.packages.${system}.codex = packages.codex;
  };

  stubModule = { lib, ... }: {
    options = {
      assertions = lib.mkOption {
        type = lib.types.listOf (
          lib.types.submodule {
            options = {
              assertion = lib.mkOption { type = lib.types.bool; };
              message = lib.mkOption { type = lib.types.str; };
            };
          }
        );
        default = [ ];
      };

      programs.codex = {
        enable = lib.mkEnableOption "Codex";
        package = lib.mkOption {
          type = lib.types.nullOr lib.types.package;
          default = null;
        };
        settings = lib.mkOption {
          type = lib.types.attrsOf lib.types.raw;
          default = { };
        };
        enableMcpIntegration = lib.mkOption {
          type = lib.types.bool;
          default = false;
        };
        plugins = lib.mkOption {
          type = lib.types.listOf lib.types.raw;
          default = [ ];
        };
        marketplaces = lib.mkOption {
          type = lib.types.attrsOf lib.types.raw;
          default = { };
        };
      };

      home = {
        homeDirectory = lib.mkOption { type = lib.types.str; };
        preferXdgDirectories = lib.mkOption {
          type = lib.types.bool;
          default = false;
        };
        packages = lib.mkOption {
          type = lib.types.listOf lib.types.package;
          default = [ ];
        };
        activation = lib.mkOption {
          type = lib.types.attrsOf lib.types.raw;
          default = { };
        };
        sessionVariables = lib.mkOption {
          type = lib.types.attrsOf lib.types.str;
          default = { };
        };
        extraBuilderCommands = lib.mkOption {
          type = lib.types.lines;
          default = "";
        };
      };

      xdg.configHome = lib.mkOption { type = lib.types.str; };
    };
  };

  mkEvaluation =
    module:
    lib.evalModules {
      specialArgs = { inherit pkgs; };
      modules = [
        stubModule
        (
          { config, lib, ... }:
          lib.mkIf (config.programs.codex.enable && config.home.preferXdgDirectories) {
            home.sessionVariables.CODEX_HOME = "${config.xdg.configHome}/codex";
          }
        )
        lazyCodexAiModule
        {
          home = {
            homeDirectory = testHome;
            preferXdgDirectories = true;
          };
          xdg.configHome = "${testHome}/.config";
        }
        module
      ];
    };

  activeEvaluation = mkEvaluation {
    programs.lazyCodexAi = {
      enable = true;
      codeGraph = false;
      codexAutonomous = false;
    };
  };
  defaultEvaluation = mkEvaluation { programs.lazyCodexAi.enable = true; };
  autonomousEvaluation = mkEvaluation {
    programs.lazyCodexAi = {
      enable = true;
      codexAutonomous = true;
    };
  };
  userOverrideEvaluation = mkEvaluation {
    programs = {
      lazyCodexAi = {
        enable = true;
        codeGraph = false;
      };
      codex.config.plugins."omo@sisyphuslabs".mcp_servers.codegraph.enabled = true;
    };
  };
  disabledEvaluation = mkEvaluation { programs.codex.enable = true; };
  retainedEvaluation = mkEvaluation { programs.lazyCodexAi.cleanupOnDisable = false; };
  composedEvaluation = lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      stubModule
      codexModule
      lazyCodexAiModule
      {
        home = {
          homeDirectory = testHome;
          preferXdgDirectories = true;
        };
        xdg.configHome = "${testHome}/.config";
        programs.lazyCodexAi.enable = true;
      }
    ];
  };

  activeConfig = activeEvaluation.config;
  disabledConfig = disabledEvaluation.config;
  activeLazyActivation = activeConfig.home.activation.lazyCodexAi;
  defaultLazyActivation = defaultEvaluation.config.home.activation.lazyCodexAi;
  autonomousLazyActivation = autonomousEvaluation.config.home.activation.lazyCodexAi;
  retainedLazyActivation = retainedEvaluation.config.home.activation.lazyCodexAi;

  commonAssertions = [
    (lib.all (assertion: assertion.assertion) activeConfig.assertions)
    activeConfig.programs.codex.enable
    (activeConfig.home.packages == [ package ])
    (
      activeConfig.programs.codex.config.plugins."omo@sisyphuslabs".mcp_servers.codegraph.enabled == false
    )
    (
      userOverrideEvaluation.config.programs.codex.config.plugins."omo@sisyphuslabs".mcp_servers.codegraph.enabled
      == true
    )
    (
      !lib.hasAttrByPath [
        "plugins"
        "omo@sisyphuslabs"
        "mcp_servers"
        "codegraph"
      ] defaultEvaluation.config.programs.codex.config
    )
    (lib.hasInfix "--no-codex-autonomous" activeLazyActivation.data)
    (!lib.hasInfix "--codex-autonomous" defaultLazyActivation.data)
    (!lib.hasInfix "--no-codex-autonomous" defaultLazyActivation.data)
    (lib.hasInfix "--codex-autonomous" autonomousLazyActivation.data)
    (!lib.hasInfix "uninstall" retainedLazyActivation.data)
    (lib.hasInfix "OMO_CODEX_PROJECT=" activeLazyActivation.data)
    (activeLazyActivation.after == [ "codexHomeMigration" ])
    (activeLazyActivation.before == [ "codexConfig" ])
    (composedEvaluation.config.programs.codex.package == packages.codex)
    (!(activeEvaluation.options.programs.lazyCodexAi ? gitBash))
    (!(activeEvaluation.options.programs.lazyCodexAi ? gitBashEnabled))
  ];

  mkActivationScript =
    name: data:
    pkgs.writeShellScript name ''
      set -euo pipefail

      run() {
        "$@"
      }

      if (( $# >= 1 )); then
        oldGenPath="$1"
      fi
      if (( $# >= 2 )); then
        newGenPath="$2"
      fi
      ${data}
    '';

  activeLazyScript = mkActivationScript "activate-lazycodex-ai" activeLazyActivation.data;
  activeCodexScript = mkActivationScript "activate-codex-after-lazycodex-ai" activeConfig.home.activation.codexConfig.data;
  defaultCodexScript = mkActivationScript "activate-codex-after-lazycodex-ai-default" defaultEvaluation.config.home.activation.codexConfig.data;
  disabledLazyScript = mkActivationScript "deactivate-lazycodex-ai" disabledConfig.home.activation.lazyCodexAi.data;
  disabledCodexScript = mkActivationScript "activate-codex-after-lazycodex-ai-disable" disabledConfig.home.activation.codexConfig.data;
in
{
  lazyCodexAiHomeModule =
    assert lib.all (assertion: assertion) commonAssertions;
    pkgs.runCommand "lazycodex-ai-home-module-check" { } ''
      derivationOutput="$out"
      activeGeneration="$TMPDIR/active-generation"
      defaultGeneration="$TMPDIR/default-generation"
      disabledGeneration="$TMPDIR/disabled-generation"
      configFile="${codexHome}/config.toml"
      pluginCache="${codexHome}/plugins/cache/sisyphuslabs/omo"

      rm -rf ${testHome}
      mkdir -p "$activeGeneration" "$defaultGeneration" "$disabledGeneration" ${testHome}

      out="$activeGeneration"
      ${activeConfig.home.extraBuilderCommands}
      test -x "$activeGeneration/${statePackage}/bin/lazycodex-ai"

      HOME=${testHome} ${activeLazyScript}
      test -d "$pluginCache"
      ${activeCodexScript} "" "$activeGeneration"
      sed -n '/^\[plugins\."omo@sisyphuslabs"\.mcp_servers\.codegraph\]$/,/^\[/p' "$configFile" \
        | grep -Fx 'enabled = false'

      HOME=${testHome} ${activeLazyScript} "$activeGeneration" "$activeGeneration"
      ${activeCodexScript} "$activeGeneration" "$activeGeneration"
      sed -n '/^\[plugins\."omo@sisyphuslabs"\.mcp_servers\.codegraph\]$/,/^\[/p' "$configFile" \
        | grep -Fx 'enabled = false'

      out="$defaultGeneration"
      ${defaultEvaluation.config.home.extraBuilderCommands}
      HOME=${testHome} ${mkActivationScript "activate-lazycodex-ai-default" defaultLazyActivation.data} \
        "$activeGeneration" "$defaultGeneration"
      ${defaultCodexScript} "$activeGeneration" "$defaultGeneration"
      sed -n '/^\[plugins\."omo@sisyphuslabs"\.mcp_servers\.codegraph\]$/,/^\[/p' "$configFile" \
        | grep -Fx 'enabled = true'

      HOME=${testHome} ${mkActivationScript "reactivate-lazycodex-ai-default" defaultLazyActivation.data} \
        "$defaultGeneration" "$defaultGeneration"
      ${defaultCodexScript} "$defaultGeneration" "$defaultGeneration"
      sed -n '/^\[plugins\."omo@sisyphuslabs"\.mcp_servers\.codegraph\]$/,/^\[/p' "$configFile" \
        | grep -Fx 'enabled = true'

      out="$disabledGeneration"
      ${disabledConfig.home.extraBuilderCommands}
      test ! -e "$disabledGeneration/${statePackage}"

      HOME=${testHome} ${disabledLazyScript} "$activeGeneration" "$disabledGeneration"
      test ! -e "$pluginCache"
      ${disabledCodexScript} "$activeGeneration" "$disabledGeneration"
      ! grep -F 'mcp_servers.codegraph' "$configFile"

      rm -rf ${testHome}
      touch "$derivationOutput"
    '';
}
