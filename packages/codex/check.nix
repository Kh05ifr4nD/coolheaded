{
  lib,
  package,
  pkgs,
  ...
}:

let
  system = pkgs.stdenv.hostPlatform.system;
  testHome = "/tmp/codex-home-module-${
    builtins.substring 0 12 (builtins.hashString "sha256" package.outPath)
  }";

  codexModule = import ../../homeModules/codex.nix { self.packages.${system}.codex = package; };

  moduleEvaluation = lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      ({ lib, ... }: {
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
      })
      (
        { config, lib, ... }:
        lib.mkIf (config.programs.codex.enable && config.home.preferXdgDirectories) {
          home.sessionVariables.CODEX_HOME = "${config.xdg.configHome}/codex";
        }
      )
      codexModule
      {
        home.homeDirectory = testHome;
        home.preferXdgDirectories = true;
        xdg.configHome = "${testHome}/.config";

        programs.codex = {
          enable = true;
          config = {
            approval_policy = "on-request";
            features.plugins = true;
            model = "gpt-5.5";
            notice.hide_full_access_warning = null;
            plugins."demo.with.dot@home-manager".enabled = true;
            projects."/tmp/a.b".trust_level = "trusted";
          };
        };
      }
    ];
  };

  migrationEvaluation = lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      ({ lib, ... }: {
        options = {
          assertions = lib.mkOption {
            type = lib.types.listOf lib.types.raw;
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
            activation = lib.mkOption {
              type = lib.types.attrsOf lib.types.raw;
              default = { };
            };
            extraBuilderCommands = lib.mkOption {
              type = lib.types.lines;
              default = "";
            };
          };
          xdg.configHome = lib.mkOption { type = lib.types.str; };
        };
      })
      codexModule
      {
        home = {
          homeDirectory = testHome;
          preferXdgDirectories = true;
        };
        xdg.configHome = "${testHome}/.config";
        programs.codex = {
          enable = true;
          migrateFromLegacyHome = true;
        };
      }
    ];
  };

  activationScript = pkgs.writeShellScript "activate-codex-home-module" ''
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
    ${moduleEvaluation.config.home.activation.codexConfig.data}
  '';

  migrationScript = pkgs.writeShellScript "migrate-codex-home-module" ''
    set -euo pipefail

    run() {
      "$@"
    }

    ${migrationEvaluation.config.home.activation.codexHomeMigration.data}
  '';

  initialConfig = pkgs.writeText "codex-initial-config.toml" ''
    # app-owned header
    model_verbosity = "low"
    model = "old-model"
    approval_policy = "never"

    [tui]
    status_line = ["z", "a"]

    [notice]
    hide_world_writable_warning = false # app-owned
    hide_full_access_warning = true

    [features]
    memories = true
    apps = true

    [projects."/tmp/a.b"]
    trust_level = "untrusted"
  '';

  expectedConfig = pkgs.writeText "codex-expected-config.toml" ''
    # app-owned header

    approval_policy = "on-request"
    model = "gpt-5.5"
    model_verbosity = "low"

    [features]
    apps = true
    plugins = true

    [notice]
    hide_world_writable_warning = false # app-owned

    [plugins."demo.with.dot@home-manager"]
    enabled = true

    [projects."/tmp/a.b"]
    trust_level = "trusted"

    [tui]
    status_line = ["z", "a"]
  '';

  freshExpectedConfig = pkgs.writeText "codex-fresh-expected-config.toml" ''
    approval_policy = "on-request"
    model = "gpt-5.5"

    [features]
    plugins = true

    [plugins."demo.with.dot@home-manager"]
    enabled = true

    [projects."/tmp/a.b"]
    trust_level = "trusted"
  '';

  oldManagedPaths = pkgs.writeText "codex-old-managed-paths.json" (
    builtins.toJSON [ ''"features"."memories"'' ]
  );

  expectedManagedPaths = pkgs.writeText "codex-expected-managed-paths.json" (
    builtins.toJSON [
      ''"approval_policy"''
      ''"features"."plugins"''
      ''"model"''
      ''"notice"."hide_full_access_warning"''
      ''"plugins"."demo.with.dot@home-manager"."enabled"''
      ''"projects"."/tmp/a.b"."trust_level"''
    ]
  );

  codexHomeModule = pkgs.runCommand "codex-home-module-check" { } ''
    derivationOutput="$out"
    target="${testHome}/.config/codex/config.toml"
    test ${lib.escapeShellArg moduleEvaluation.config.home.sessionVariables.CODEX_HOME} = ${lib.escapeShellArg "${testHome}/.config/codex"}
    rm -rf ${testHome}
    mkdir -p "$(dirname "$target")" "$TMPDIR/old-generation/state" "$TMPDIR/new-generation"
    install -m 600 ${initialConfig} "$target"
    install -m 444 ${oldManagedPaths} "$TMPDIR/old-generation/state/codex-managed-paths.json"

    out="$TMPDIR/new-generation"
    ${moduleEvaluation.config.home.extraBuilderCommands}
    diff -u ${expectedManagedPaths} "$out/state/codex-managed-paths.json"
    out="$derivationOutput"

    ${activationScript} "$TMPDIR/old-generation" "$TMPDIR/new-generation"
    diff -u ${expectedConfig} "$target"
    test "$(stat -c %a "$target")" = 600

    inode="$(stat -c %i "$target")"
    ${activationScript} "$TMPDIR/old-generation" "$TMPDIR/new-generation"
    diff -u ${expectedConfig} "$target"
    test "$(stat -c %i "$target")" = "$inode"

    rm -rf ${testHome}
    ${activationScript}
    diff -u ${freshExpectedConfig} "$target"
    test "$(stat -c %a "$target")" = 600
    test ! -e "${testHome}/.codex/config.toml"

    rm -rf ${testHome}
    legacy="${testHome}/.codex"
    migrated="${testHome}/.config/codex"
    mkdir -p "$legacy"
    exec 9>"$legacy/open-session"
    if ${migrationScript}; then
      echo "migration accepted an in-use source directory" >&2
      exit 1
    fi
    exec 9>&-
    test -e "$legacy/open-session"

    rm -rf ${testHome}
    mkdir -p "$legacy/state"
    install -m 600 ${initialConfig} "$legacy/config.toml"
    printf 'session\n' > "$legacy/state/session"
    ln "$legacy/state/session" "$legacy/state/session-hardlink"
    ln -s session "$legacy/state/session-symlink"

    ${migrationScript}
    test ! -e "$legacy"
    test -d "$migrated"
    diff -u ${initialConfig} "$migrated/config.toml"
    test "$(stat -c %a "$migrated/config.toml")" = 600
    test "$(stat -c %i "$migrated/state/session")" = "$(stat -c %i "$migrated/state/session-hardlink")"
    test "$(readlink "$migrated/state/session-symlink")" = session
    backups=("$legacy".backup-*)
    test "''${#backups[@]}" = 1
    test -d "''${backups[0]}"

    ${migrationScript}
    repeatedBackups=("$legacy".backup-*)
    test "''${#repeatedBackups[@]}" = 1

    mkdir -p "$legacy"
    printf 'collision\n' > "$legacy/sentinel"
    if ${migrationScript}; then
      echo "migration accepted simultaneous source and target" >&2
      exit 1
    fi
    grep -Fx collision "$legacy/sentinel"
    test -d "$migrated"

    rm -rf ${testHome}
    touch "$out"
  '';
in
{
  inherit codexHomeModule;
}
// lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
  codexMinimal = package.override {
    withRipgrep = false;
    withBubblewrap = false;
  };
}
