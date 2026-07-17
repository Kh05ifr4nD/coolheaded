{
  lib,
  package,
  pkgs,
  ...
}:

let
  system = pkgs.stdenv.hostPlatform.system;
  fakeHomeManagerModulesPath = "/home-manager/modules";
  testHomeName = "codex-home-module-${
    builtins.substring 0 12 (builtins.hashString "sha256" package.outPath)
  }";
  testHome = "/__${testHomeName}__";

  codexModule = import ../../homeModules/codex.nix { self.packages.${system}.codex = package; };
  bundledCodexModule = {
    key = "${fakeHomeManagerModulesPath}/programs/codex";
    options.programs.codex.enable = lib.mkOption { type = lib.types.str; };
  };
  baseModule = { lib, ... }: {
    options = {
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
      };
      xdg.configHome = lib.mkOption { type = lib.types.str; };
    };
  };

  declaredSettings = {
    approval_policy = "on-request";
    features.plugins = true;
    model = "gpt-5.5";
    notice.hide_full_access_warning = null;
    plugins."demo.with.dot@home-manager".enabled = true;
    projects."/tmp/a.b".trust_level = "trusted";
  };
  mkEvaluation =
    { preferXdgDirectories, settings }:
    lib.evalModules {
      specialArgs = {
        inherit pkgs;
        modulesPath = fakeHomeManagerModulesPath;
      };
      modules = [
        baseModule
        bundledCodexModule
        codexModule
        {
          home = {
            homeDirectory = testHome;
            inherit preferXdgDirectories;
          };
          xdg.configHome = "${testHome}/.config";
          programs.codex = {
            enable = true;
            inherit settings;
          };
        }
      ];
    };

  xdgEvaluation = mkEvaluation {
    preferXdgDirectories = true;
    settings = declaredSettings;
  };
  emptyEvaluation = mkEvaluation {
    preferXdgDirectories = true;
    settings = { };
  };
  legacyEvaluation = mkEvaluation {
    preferXdgDirectories = false;
    settings = declaredSettings;
  };

  mkActivation =
    name: evaluation:
    pkgs.writeShellScript name ''
      set -euo pipefail

      run() {
        "$@"
      }

      if (( $# >= 1 )); then
        oldGenPath="$1"
      fi
      ${evaluation.config.home.activation.codexConfig.data}
    '';
  xdgActivation = mkActivation "activate-codex-xdg-home-module" xdgEvaluation;
  emptyActivation = mkActivation "activate-codex-empty-home-module" emptyEvaluation;
  legacyActivation = mkActivation "activate-codex-legacy-home-module" legacyEvaluation;

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
    memories = true
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
  appOnlyConfig = pkgs.writeText "codex-app-only-config.toml" ''
    # retained comment
    model_verbosity = "low"
    model = "app-model"

    [features]
    memories = true
    apps = true
  '';
  sortedAppOnlyConfig = pkgs.writeText "codex-sorted-app-only-config.toml" ''
    # retained comment

    model = "app-model"
    model_verbosity = "low"

    [features]
    apps = true
    memories = true
  '';
  legacyConfig = pkgs.writeText "codex-legacy-config.toml" ''
    model = "legacy-model"
  '';
  oldManagedPaths = pkgs.writeText "codex-old-managed-paths.json" (
    builtins.toJSON [ ''"features"."memories"'' ]
  );
in
{
  codexHomeModule =
    assert builtins.attrNames xdgEvaluation.config.home.activation == [ "codexConfig" ];
    assert xdgEvaluation.config.home.activation.codexConfig.after == [ "linkGeneration" ];
    assert
      builtins.attrNames xdgEvaluation.options.programs.codex == [
        "enable"
        "package"
        "settings"
      ];
    assert xdgEvaluation.config.home.sessionVariables.CODEX_HOME == "${testHome}/.config/codex";
    assert !(legacyEvaluation.config.home.sessionVariables ? CODEX_HOME);
    assert lib.elem package xdgEvaluation.config.home.packages;
    pkgs.runCommand "codex-home-module-check" { } ''
      shopt -s nullglob
      testHome="$NIX_BUILD_TOP/${testHomeName}"
      case "$testHome" in
        "$NIX_BUILD_TOP"/*) ;;
        *)
          echo "Codex module test home is outside NIX_BUILD_TOP: $testHome" >&2
          exit 1
          ;;
      esac

      xdgActivation="$TMPDIR/activate-codex-xdg-home-module"
      emptyActivation="$TMPDIR/activate-codex-empty-home-module"
      legacyActivation="$TMPDIR/activate-codex-legacy-home-module"
      substitute ${xdgActivation} "$xdgActivation" \
        --replace-fail ${lib.escapeShellArg testHome} "$testHome"
      substitute ${emptyActivation} "$emptyActivation" \
        --replace-fail ${lib.escapeShellArg testHome} "$testHome"
      substitute ${legacyActivation} "$legacyActivation" \
        --replace-fail ${lib.escapeShellArg testHome} "$testHome"
      chmod +x "$xdgActivation" "$emptyActivation" "$legacyActivation"

      target="$testHome/.config/codex/config.toml"
      legacyTarget="$testHome/.codex/config.toml"
      cleanupTestHome() {
        ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
          if [[ -d "$testHome" ]]; then
            ${pkgs.darwin.file_cmds}/bin/chmod -f -RN "$testHome" || true
          fi
        ''}
        chmod -R u+rwX "$testHome" 2>/dev/null || true
        rm -rf "$testHome"
      }
      assertNoTransactionArtifacts() {
        local artifacts=(
          "$(dirname "$target")"/.config.toml.home-manager.*
          "$target".backup*
        )
        test "''${#artifacts[@]}" = 0
      }

      cleanupTestHome
      mkdir -p "$(dirname "$target")" "$(dirname "$legacyTarget")" "$TMPDIR/old-generation/state"
      install -m 640 ${initialConfig} "$target"
      install -m 600 ${legacyConfig} "$legacyTarget"
      install -m 444 ${oldManagedPaths} "$TMPDIR/old-generation/state/codex-managed-paths.json"
      legacyHash="$(${pkgs.coreutils}/bin/sha256sum "$legacyTarget" | cut -d ' ' -f 1)"

      "$xdgActivation" "$TMPDIR/old-generation"
      diff -u ${expectedConfig} "$target"
      test "$(${pkgs.coreutils}/bin/stat -c %a "$target")" = 640
      test "$(${pkgs.coreutils}/bin/sha256sum "$legacyTarget" | cut -d ' ' -f 1)" = "$legacyHash"
      test ! -L "$testHome/.codex"
      assertNoTransactionArtifacts

      inode="$(${pkgs.coreutils}/bin/stat -c %i "$target")"
      "$xdgActivation" "$TMPDIR/old-generation"
      diff -u ${expectedConfig} "$target"
      test "$(${pkgs.coreutils}/bin/stat -c %i "$target")" = "$inode"
      assertNoTransactionArtifacts

      cleanupTestHome
      "$xdgActivation"
      diff -u ${freshExpectedConfig} "$target"
      test "$(${pkgs.coreutils}/bin/stat -c %a "$target")" = 600
      test ! -e "$testHome/.codex"
      assertNoTransactionArtifacts

      cleanupTestHome
      "$emptyActivation"
      test -d "$(dirname "$target")"
      test ! -e "$target"

      install -m 644 ${appOnlyConfig} "$target"
      "$emptyActivation"
      diff -u ${sortedAppOnlyConfig} "$target"
      test "$(${pkgs.coreutils}/bin/stat -c %a "$target")" = 644
      assertNoTransactionArtifacts

      install -m 600 /dev/null "$target"
      printf 'model =\\n' > "$target"
      invalidHash="$(${pkgs.coreutils}/bin/sha256sum "$target" | cut -d ' ' -f 1)"
      if "$xdgActivation" >"$TMPDIR/invalid.out" 2>"$TMPDIR/invalid.err"; then
        echo "Codex reconciliation accepted invalid TOML" >&2
        exit 1
      fi
      test "$(${pkgs.coreutils}/bin/sha256sum "$target" | cut -d ' ' -f 1)" = "$invalidHash"
      assertNoTransactionArtifacts

      cleanupTestHome
      mkdir -p "$(dirname "$target")"
      victim="$TMPDIR/codex-config-victim.toml"
      install -m 600 ${initialConfig} "$victim"
      victimHash="$(${pkgs.coreutils}/bin/sha256sum "$victim" | cut -d ' ' -f 1)"
      ln -s "$victim" "$target"
      if "$xdgActivation" >"$TMPDIR/symlink.out" 2>"$TMPDIR/symlink.err"; then
        echo "Codex reconciliation accepted a config symlink" >&2
        exit 1
      fi
      test -L "$target"
      test "$(${pkgs.coreutils}/bin/sha256sum "$victim" | cut -d ' ' -f 1)" = "$victimHash"
      assertNoTransactionArtifacts

      cleanupTestHome
      mkdir -p "$target"
      if "$xdgActivation" >"$TMPDIR/non-regular.out" 2>"$TMPDIR/non-regular.err"; then
        echo "Codex reconciliation accepted a non-regular config path" >&2
        exit 1
      fi
      test -d "$target"

      cleanupTestHome
      mkdir -p "$(dirname "$legacyTarget")"
      "$legacyActivation"
      diff -u ${freshExpectedConfig} "$legacyTarget"
      test ! -e "$target"

      cleanupTestHome
      touch "$out"
    '';
}
