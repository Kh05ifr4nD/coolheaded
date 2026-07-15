{
  lib,
  package,
  packages,
  pkgs,
  ...
}:

let
  system = pkgs.stdenv.hostPlatform.system;
  fakeHomeManagerModulesPath = "/home-manager/modules";
  testHome = "/tmp/lazycodex-ai-home-module-${
    builtins.substring 0 12 (builtins.hashString "sha256" package.outPath)
  }";
  codexHome = "${testHome}/.config/codex";
  statePackage = "state/lazycodex-ai-package";
  stateInstallFingerprint = "state/lazycodex-ai-install-fingerprint";

  lazyCodexAiModule = import ../../homeModules/lazyCodexAi.nix {
    self.packages.${system} = {
      codex = packages.codex;
      lazyCodexAi = package;
    };
  };
  codexModule = import ../../homeModules/codex.nix {
    self.packages.${system}.codex = packages.codex;
  };
  bundledCodexModule = {
    key = "${fakeHomeManagerModulesPath}/programs/codex";
    options.programs.codex.enable = lib.mkOption { type = lib.types.str; };
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
      specialArgs = {
        inherit pkgs;
        modulesPath = fakeHomeManagerModulesPath;
      };
      modules = [
        stubModule
        bundledCodexModule
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
      codex.settings.plugins."omo@sisyphuslabs".mcp_servers.codegraph.enabled = true;
    };
  };
  disabledEvaluation = mkEvaluation { programs.codex.enable = true; };
  retainedEvaluation = mkEvaluation { programs.lazyCodexAi.cleanupOnDisable = false; };
  failingPackage = pkgs.writeShellApplication {
    name = "lazycodex-ai";
    text = "exit 23";
  };
  failingEvaluation = mkEvaluation {
    programs.lazyCodexAi = {
      enable = true;
      package = failingPackage;
    };
  };
  countingPackage = pkgs.writeShellApplication {
    name = "lazycodex-ai";
    text = ''
      printf '%s\n' "$*" >> "''${LAZYCODEX_AI_TEST_INVOCATIONS:?}"
      exec ${package}/bin/lazycodex-ai "$@"
    '';
  };
  idempotentEvaluation = mkEvaluation {
    programs.lazyCodexAi = {
      enable = true;
      package = countingPackage;
    };
  };
  composedEvaluation = lib.evalModules {
    specialArgs = {
      inherit pkgs;
      modulesPath = fakeHomeManagerModulesPath;
    };
    modules = [
      stubModule
      bundledCodexModule
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
    (activeConfig.programs.codex.package == packages.codex)
    (lib.length activeConfig.home.packages == 2)
    (lib.elem package activeConfig.home.packages)
    (lib.elem packages.codex activeConfig.home.packages)
    (activeConfig.home.sessionVariables.CODEX_HOME == codexHome)
    (activeEvaluation.options.programs.codex ? settings)
    (!(activeEvaluation.options.programs.codex ? config))
    (
      activeConfig.programs.codex.settings.plugins."omo@sisyphuslabs".mcp_servers.codegraph.enabled
      == false
    )
    (
      userOverrideEvaluation.config.programs.codex.settings.plugins."omo@sisyphuslabs".mcp_servers.codegraph.enabled
      == true
    )
    (
      !lib.hasAttrByPath [
        "plugins"
        "omo@sisyphuslabs"
        "mcp_servers"
        "codegraph"
      ] defaultEvaluation.config.programs.codex.settings
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

      parentTrapSentinel="''${TMPDIR:-/tmp}/${name}-parent-trap"
      trap 'touch "$parentTrapSentinel"' EXIT
      parentExitTrap="$(trap -p EXIT)"

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

      test "$(trap -p EXIT)" = "$parentExitTrap"
      trap - EXIT
    '';

  activeLazyScript = mkActivationScript "activate-lazycodex-ai" activeLazyActivation.data;
  activeCodexScript = mkActivationScript "activate-codex-after-lazycodex-ai" activeConfig.home.activation.codexConfig.data;
  defaultCodexScript = mkActivationScript "activate-codex-after-lazycodex-ai-default" defaultEvaluation.config.home.activation.codexConfig.data;
  disabledLazyScript = mkActivationScript "deactivate-lazycodex-ai" disabledConfig.home.activation.lazyCodexAi.data;
  disabledCodexScript = mkActivationScript "activate-codex-after-lazycodex-ai-disable" disabledConfig.home.activation.codexConfig.data;
  failingLazyScript = mkActivationScript "activate-lazycodex-ai-failing" failingEvaluation.config.home.activation.lazyCodexAi.data;
  idempotentLazyScript = mkActivationScript "activate-lazycodex-ai-idempotent" idempotentEvaluation.config.home.activation.lazyCodexAi.data;
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
      test -s "$activeGeneration/${stateInstallFingerprint}"

      HOME=${testHome} ${activeLazyScript}
      test ! -e "$TMPDIR/activate-lazycodex-ai-parent-trap"
      test -d "$pluginCache"
      ${activeCodexScript} "" "$activeGeneration"
      sed -n '/^\[plugins\."omo@sisyphuslabs"\.mcp_servers\.codegraph\]$/,/^\[/p' "$configFile" \
        | grep -Fx 'enabled = false'

      HOME=${testHome} ${activeLazyScript} "$activeGeneration" "$activeGeneration"
      ${activeCodexScript} "$activeGeneration" "$activeGeneration"
      sed -n '/^\[plugins\."omo@sisyphuslabs"\.mcp_servers\.codegraph\]$/,/^\[/p' "$configFile" \
        | grep -Fx 'enabled = false'

      idempotentGeneration="$TMPDIR/idempotent-generation"
      idempotentInvocations="$TMPDIR/idempotent-invocations"
      mkdir -p "$idempotentGeneration"
      out="$idempotentGeneration"
      ${idempotentEvaluation.config.home.extraBuilderCommands}
      HOME=${testHome} LAZYCODEX_AI_TEST_INVOCATIONS="$idempotentInvocations" \
        ${idempotentLazyScript} "" "$idempotentGeneration"
      HOME=${testHome} LAZYCODEX_AI_TEST_INVOCATIONS="$idempotentInvocations" \
        ${idempotentLazyScript} "$idempotentGeneration" "$idempotentGeneration"
      mapfile -t idempotentInvocationLines < "$idempotentInvocations"
      test "''${#idempotentInvocationLines[@]}" -eq 1
      test "''${idempotentInvocationLines[0]}" = "install --no-tui"

      rm -rf "$pluginCache"
      HOME=${testHome} LAZYCODEX_AI_TEST_INVOCATIONS="$idempotentInvocations" \
        ${idempotentLazyScript} "$idempotentGeneration" "$idempotentGeneration"
      mapfile -t idempotentInvocationLines < "$idempotentInvocations"
      test "''${#idempotentInvocationLines[@]}" -eq 2

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

      failureTmp="$TMPDIR/failing-activation"
      mkdir -p "$failureTmp"
      if HOME=${testHome} TMPDIR="$failureTmp" ${failingLazyScript}; then
        echo "failing LazyCodex activation unexpectedly succeeded" >&2
        exit 1
      fi
      test -e "$failureTmp/activate-lazycodex-ai-failing-parent-trap"
      for candidate in "$failureTmp"/lazycodex-ai-project.*; do
        if [[ -e "$candidate" ]]; then
          echo "failing LazyCodex activation leaked its temporary project" >&2
          exit 1
        fi
      done

      rm -rf ${testHome}
      touch "$derivationOutput"
    '';
}
