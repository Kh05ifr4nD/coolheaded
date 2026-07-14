{
  lib,
  package,
  pkgs,
  ...
}:

let
  system = pkgs.stdenv.hostPlatform.system;
  testHomeName = "codex-home-module-${
    builtins.substring 0 12 (builtins.hashString "sha256" package.outPath)
  }";
  testHome = "/__${testHomeName}__";

  renameNoReplace = import ../../lib/nix/renameNoReplace.nix { inherit pkgs; };
  productionMigration = import ../../lib/nix/codexHomeMigrate.nix { inherit pkgs; };
  testMigration = import ../../lib/nix/codexHomeMigrate.nix {
    inherit pkgs;
    trustUnmappedOwnersForTests = pkgs.stdenv.hostPlatform.isLinux;
  };
  codexModule = import ../../homeModules/codex.nix {
    self.packages.${system}.codex = package;
    codexHomeMigrationPackage = testMigration;
  };

  signalRenameNoReplace = pkgs.writeShellScriptBin "rename-no-replace" ''
    set -euo pipefail

    stateFile="''${CODEX_HOME_MIGRATION_TEST_SIGNAL_STATE:?}"
    count=0
    if [[ -s "$stateFile" ]]; then
      read -r count < "$stateFile"
    fi
    count=$((count + 1))
    printf '%s\n' "$count" > "$stateFile"

    ${lib.getExe renameNoReplace} "$@"
    if [[ "$count" == "''${CODEX_HOME_MIGRATION_TEST_SIGNAL_AFTER:?}" ]]; then
      kill -TERM "$PPID"
    fi
  '';

  signalMigration = import ../../lib/nix/codexHomeMigrate.nix {
    inherit pkgs;
    renameNoReplace = signalRenameNoReplace;
    trustUnmappedOwnersForTests = pkgs.stdenv.hostPlatform.isLinux;
  };

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

  barrierLsof = pkgs.writeShellScriptBin "lsof" ''
    ${lib.getExe pkgs.lsof} "$@"
    result="$?"
    if (( result == 0 )) && [[ -n "''${CODEX_HOME_MIGRATION_TEST_BARRIER:-}" ]]; then
      if ${pkgs.coreutils}/bin/mkdir "$CODEX_HOME_MIGRATION_TEST_BARRIER.claim" 2>/dev/null; then
        ${pkgs.coreutils}/bin/touch "$CODEX_HOME_MIGRATION_TEST_BARRIER.ready"
        for _ in {1..1000}; do
          [[ -e "$CODEX_HOME_MIGRATION_TEST_BARRIER.release" ]] && break
          ${pkgs.coreutils}/bin/sleep 0.01
        done
        if [[ ! -e "$CODEX_HOME_MIGRATION_TEST_BARRIER.release" ]]; then
          echo "timed out waiting to release the Codex migration test barrier" >&2
          exit 1
        fi
      fi
    fi
    exit "$result"
  '';

  barrierMigration = import ../../lib/nix/codexHomeMigrate.nix {
    pkgs = pkgs // {
      lsof = barrierLsof;
    };
    trustUnmappedOwnersForTests = pkgs.stdenv.hostPlatform.isLinux;
  };

  barrierMigrationScript = pkgs.writeShellScript "migrate-codex-home-with-barrier" ''
    set -euo pipefail
    legacy="$1"
    migrated="$2"
    ${lib.getExe barrierMigration} "$legacy" "$migrated"
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
    testHome="$NIX_BUILD_TOP/${testHomeName}"
    case "$testHome" in
      "$NIX_BUILD_TOP"/*) ;;
      *)
        echo "Codex module test home is outside NIX_BUILD_TOP: $testHome" >&2
        exit 1
        ;;
    esac
    activationUnderTest="$TMPDIR/activate-codex-home-module"
    migrationUnderTest="$TMPDIR/migrate-codex-home-module"
    substitute ${activationScript} "$activationUnderTest" \
      --replace-fail ${lib.escapeShellArg testHome} "$testHome"
    substitute ${migrationScript} "$migrationUnderTest" \
      --replace-fail ${lib.escapeShellArg testHome} "$testHome"
    chmod +x "$activationUnderTest" "$migrationUnderTest"
    if grep -F 'rootOwnerIsUnmapped' ${lib.getExe productionMigration}; then
      echo "production migration trusts an unprovable overflow UID" >&2
      exit 1
    fi
    ${lib.getExe productionMigration} --help >"$TMPDIR/migration-help.out"
    grep -F "Usage: codex-home-migrate LEGACY TARGET" "$TMPDIR/migration-help.out"
    if ${lib.getExe productionMigration} only-one-argument \
      >"$TMPDIR/migration-invalid.out" 2>"$TMPDIR/migration-invalid.err"; then
      echo "migration accepted an invalid argument count" >&2
      exit 1
    fi
    grep -F "Usage: codex-home-migrate LEGACY TARGET" "$TMPDIR/migration-invalid.err"
    ${lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
      grep -F 'testOnlyUnmappedOwner=' ${lib.getExe testMigration}
    ''}

    target="$testHome/.config/codex/config.toml"
    cleanupTestHome() {
      ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
        if [[ -d "$testHome" ]]; then
          ${pkgs.darwin.file_cmds}/bin/chmod -RN "$testHome" || true
        fi
      ''}
      chmod -R u+rwX "$testHome" 2>/dev/null || true
      rm -rf "$testHome"
    }
    test ${lib.escapeShellArg moduleEvaluation.config.home.sessionVariables.CODEX_HOME} = ${lib.escapeShellArg "${testHome}/.config/codex"}
    cleanupTestHome
    mkdir -p "$(dirname "$target")" "$TMPDIR/old-generation/state" "$TMPDIR/new-generation"
    install -m 600 ${initialConfig} "$target"
    install -m 444 ${oldManagedPaths} "$TMPDIR/old-generation/state/codex-managed-paths.json"

    out="$TMPDIR/new-generation"
    ${moduleEvaluation.config.home.extraBuilderCommands}
    diff -u ${expectedManagedPaths} "$out/state/codex-managed-paths.json"
    out="$derivationOutput"

    "$activationUnderTest" "$TMPDIR/old-generation" "$TMPDIR/new-generation"
    diff -u ${expectedConfig} "$target"
    test "$(stat -c %a "$target")" = 600

    inode="$(stat -c %i "$target")"
    "$activationUnderTest" "$TMPDIR/old-generation" "$TMPDIR/new-generation"
    diff -u ${expectedConfig} "$target"
    test "$(stat -c %i "$target")" = "$inode"

    cleanupTestHome
    "$activationUnderTest"
    diff -u ${freshExpectedConfig} "$target"
    test "$(stat -c %a "$target")" = 600
    test ! -e "$testHome/.codex/config.toml"

    cleanupTestHome
    legacy="$testHome/.codex"
    migrated="$testHome/.config/codex"
    ${lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
      if [[ "$(stat -c %u /)" != 0 ]]; then
        mkdir -p "$legacy/state"
        printf 'unmapped-root\n' > "$legacy/state/sentinel"
        if ${lib.getExe productionMigration} "$legacy" "$migrated" \
          >"$TMPDIR/unmapped-root.out" 2>"$TMPDIR/unmapped-root.err"; then
          echo "production migration trusted an unmapped root owner" >&2
          exit 1
        fi
        grep -F "refuses a target-path ancestor owned by another user: /" "$TMPDIR/unmapped-root.err"
        grep -Fx unmapped-root "$legacy/state/sentinel"
        test ! -e "$migrated"
        cleanupTestHome
      fi
    ''}
    mkdir -p "$legacy"
    exec 9>"$legacy/open-session"
    if "$migrationUnderTest"; then
      echo "migration accepted an in-use source directory" >&2
      exit 1
    fi
    exec 9>&-
    test -e "$legacy/open-session"

    cleanupTestHome
    mkdir -p "$legacy/unreadable"
    chmod 000 "$legacy/unreadable"
    if "$migrationUnderTest" >"$TMPDIR/lsof-failure.out" 2>"$TMPDIR/lsof-failure.err"; then
      echo "migration accepted an incomplete open-file scan" >&2
      exit 1
    fi
    chmod 700 "$legacy/unreadable"
    grep -F "Unable to verify that the Codex home is unused" "$TMPDIR/lsof-failure.err"
    test -d "$legacy"
    test ! -e "$migrated"

    cleanupTestHome
    mkdir -p "$legacy/state" "$(dirname "$migrated")"
    chmod 0770 "$(dirname "$migrated")"
    if "$migrationUnderTest" >"$TMPDIR/unsafe-parent.out" 2>"$TMPDIR/unsafe-parent.err"; then
      echo "migration accepted a group-writable target parent" >&2
      exit 1
    fi
    grep -F "requires a user-owned target parent without group or other write access" "$TMPDIR/unsafe-parent.err"
    test -d "$legacy"
    test ! -e "$migrated"

    ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
      chmod 0700 "$(dirname "$migrated")"
      ${pkgs.darwin.file_cmds}/bin/chmod +a "everyone allow add_file" "$(dirname "$migrated")"
      if "$migrationUnderTest" >"$TMPDIR/acl-parent.out" 2>"$TMPDIR/acl-parent.err"; then
        echo "migration accepted a target parent with an extended ACL" >&2
        exit 1
      fi
      grep -F "refuses a writable extended ACL in the target path" "$TMPDIR/acl-parent.err"
      test -d "$legacy"
      test ! -e "$migrated"

      ${pkgs.darwin.file_cmds}/bin/chmod -N "$(dirname "$migrated")"
      ${pkgs.darwin.file_cmds}/bin/chmod +a "everyone allow writesecurity" "$(dirname "$migrated")"
      if "$migrationUnderTest" >"$TMPDIR/acl-security.out" 2>"$TMPDIR/acl-security.err"; then
        echo "migration accepted an ACL that can grant new write permissions" >&2
        exit 1
      fi
      grep -F "refuses a writable extended ACL in the target path" "$TMPDIR/acl-security.err"
      test -d "$legacy"
      test ! -e "$migrated"
    ''}

    ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
      cleanupTestHome
      mkdir -p "$legacy/state" "$(dirname "$migrated")"
      printf 'safe-deny-acl\n' > "$legacy/state/session"
      ${pkgs.darwin.file_cmds}/bin/chmod +a "everyone deny delete" "$testHome"
      "$migrationUnderTest"
      grep -Fx safe-deny-acl "$migrated/state/session"
    ''}

    cleanupTestHome
    unsafeAncestor="$testHome/unsafe-ancestor"
    unsafeAncestorTarget="$unsafeAncestor/safe-parent/codex"
    mkdir -p "$legacy/state" "$(dirname "$unsafeAncestorTarget")"
    chmod 0777 "$unsafeAncestor"
    if ${lib.getExe barrierMigration} "$legacy" "$unsafeAncestorTarget" >"$TMPDIR/unsafe-ancestor.out" 2>"$TMPDIR/unsafe-ancestor.err"; then
      echo "migration accepted a target path below a writable non-sticky ancestor" >&2
      exit 1
    fi
    grep -F "refuses a writable non-sticky target-path ancestor" "$TMPDIR/unsafe-ancestor.err"
    test -d "$legacy"
    test ! -e "$unsafeAncestorTarget"

    cleanupTestHome
    mkdir -p "$legacy/state"
    printf 'before-scan\n' > "$legacy/state/session"
    printf 'linked-before\n' > "$legacy/state/link-a"
    ln "$legacy/state/link-a" "$legacy/state/link-b"
    ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
      ${pkgs.darwin.file_cmds}/bin/chmod +a "everyone deny delete" "$legacy/state/session"
      ${pkgs.darwin.file_cmds}/bin/xattr -w com.example.codex-migration keep-me "$legacy/state/session"
      grep -F 'rsyncArgs+=(--filter "-x com.apple.provenance")' ${lib.getExe barrierMigration}
    ''}
    ${lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
      linuxXattrError="$TMPDIR/codex-home-linux-xattr.err"
      if ${pkgs.attr}/bin/setfattr -n user.codex-migration -v keep-me "$legacy/state/session" 2>"$linuxXattrError"; then
        linuxXattrSupported=1
      elif [[ "$(cat "$linuxXattrError")" == *"Operation not supported"* ]]; then
        linuxXattrSupported=
      else
        cat "$linuxXattrError" >&2
        exit 1
      fi
      rm -f "$linuxXattrError"
      if grep -F 'com.apple.provenance' ${lib.getExe barrierMigration}; then
        echo "Linux migration unexpectedly filters a Darwin xattr" >&2
        exit 1
      fi
    ''}
    barrier="$TMPDIR/codex-home-migration-barrier"
    rm -rf "$barrier.claim" "$barrier.ready" "$barrier.release"
    (
      for _ in {1..1000}; do
        [[ -e "$barrier.ready" ]] && break
        sleep 0.01
      done
      if [[ ! -e "$barrier.ready" ]]; then
        echo "timed out waiting for the Codex migration test barrier" >&2
        exit 1
      fi
      printf 'after-scan\n' > "$legacy/state/session"
      rm "$legacy/state/link-b"
      printf 'linked-after\n' > "$legacy/state/link-b"
      touch "$barrier.release"
    ) &
    mutator="$!"
    CODEX_HOME_MIGRATION_TEST_BARRIER="$barrier" ${barrierMigrationScript} "$legacy" "$migrated"
    wait "$mutator"
    grep -Fx after-scan "$migrated/state/session"
    grep -Fx linked-before "$migrated/state/link-a"
    grep -Fx linked-after "$migrated/state/link-b"
    test "$(stat -c %i "$migrated/state/link-a")" != "$(stat -c %i "$migrated/state/link-b")"
    ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
      ${pkgs.darwin.file_cmds}/bin/ls -le "$migrated/state/session" | grep -F "everyone deny delete"
      test "$(${pkgs.darwin.file_cmds}/bin/xattr -p com.example.codex-migration "$migrated/state/session")" = keep-me
    ''}
    ${lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
      if [[ -n "$linuxXattrSupported" ]]; then
        test "$(${pkgs.attr}/bin/getfattr --only-values -n user.codex-migration "$migrated/state/session")" = keep-me
      fi
    ''}

    cleanupTestHome
    interruptedStage="$testHome/.config/.codex-home-migration.interrupted"
    mkdir -p "$legacy/state" "$interruptedStage/state"
    printf 'source-data\n' > "$legacy/state/sentinel"
    printf 'staged-data\n' > "$interruptedStage/state/sentinel"
    if "$migrationUnderTest" >"$TMPDIR/interrupted-stage.out" 2>"$TMPDIR/interrupted-stage.err"; then
      echo "migration ignored staged data from an interrupted run" >&2
      exit 1
    fi
    grep -F "Codex home migration found staged data from an interrupted run" "$TMPDIR/interrupted-stage.err"
    grep -F "$interruptedStage" "$TMPDIR/interrupted-stage.err"
    grep -Fx source-data "$legacy/state/sentinel"
    grep -Fx staged-data "$interruptedStage/state/sentinel"
    test ! -e "$migrated"

    cleanupTestHome
    interruptedBackup="$legacy.backup-interrupted"
    mkdir -p "$interruptedBackup/state"
    install -m 600 ${initialConfig} "$interruptedBackup/config.toml"
    printf 'rollback-data\n' > "$interruptedBackup/state/sentinel"
    if "$migrationUnderTest" >"$TMPDIR/interrupted-migration.out" 2>"$TMPDIR/interrupted-migration.err"; then
      echo "migration ignored rollback data from an interrupted run" >&2
      exit 1
    fi
    grep -F "Codex home migration found rollback data without a source or target" "$TMPDIR/interrupted-migration.err"
    grep -F "$interruptedBackup" "$TMPDIR/interrupted-migration.err"
    diff -u ${initialConfig} "$interruptedBackup/config.toml"
    grep -Fx rollback-data "$interruptedBackup/state/sentinel"
    test ! -e "$legacy"
    test ! -e "$migrated"

    cleanupTestHome
    mkdir -p "$legacy/state"
    printf 'first-rename\n' > "$legacy/state/sentinel"
    signalState="$TMPDIR/codex-home-signal-state"
    rm -f "$signalState"
    if CODEX_HOME_MIGRATION_TEST_SIGNAL_STATE="$signalState" \
      CODEX_HOME_MIGRATION_TEST_SIGNAL_AFTER=1 \
      ${lib.getExe signalMigration} "$legacy" "$migrated"; then
      echo "migration ignored TERM immediately after the source rename" >&2
      exit 1
    fi
    grep -Fx first-rename "$legacy/state/sentinel"
    test ! -e "$migrated"
    firstSignalBackups=("$legacy".backup-*)
    test "''${#firstSignalBackups[@]}" = 0

    cleanupTestHome
    mkdir -p "$legacy/state"
    printf 'second-rename\n' > "$legacy/state/sentinel"
    rm -f "$signalState"
    if CODEX_HOME_MIGRATION_TEST_SIGNAL_STATE="$signalState" \
      CODEX_HOME_MIGRATION_TEST_SIGNAL_AFTER=2 \
      ${lib.getExe signalMigration} "$legacy" "$migrated"; then
      echo "migration ignored TERM immediately after the target rename" >&2
      exit 1
    fi
    test ! -e "$legacy"
    grep -Fx second-rename "$migrated/state/sentinel"
    secondSignalBackups=("$legacy".backup-*)
    test "''${#secondSignalBackups[@]}" = 1
    grep -Fx second-rename "''${secondSignalBackups[0]}/state/sentinel"

    cleanupTestHome
    mkdir -p "$legacy/state"
    install -m 600 ${initialConfig} "$legacy/config.toml"
    printf 'session\n' > "$legacy/state/session"
    ln "$legacy/state/session" "$legacy/state/session-hardlink"
    ln -s session "$legacy/state/session-symlink"

    "$migrationUnderTest"
    test ! -e "$legacy"
    test -d "$migrated"
    diff -u ${initialConfig} "$migrated/config.toml"
    test "$(stat -c %a "$migrated/config.toml")" = 600
    test "$(stat -c %i "$migrated/state/session")" = "$(stat -c %i "$migrated/state/session-hardlink")"
    test "$(readlink "$migrated/state/session-symlink")" = session
    backups=("$legacy".backup-*)
    test "''${#backups[@]}" = 1
    test -d "''${backups[0]}"

    "$migrationUnderTest"
    repeatedBackups=("$legacy".backup-*)
    test "''${#repeatedBackups[@]}" = 1

    mkdir -p "$legacy"
    printf 'collision\n' > "$legacy/sentinel"
    if "$migrationUnderTest"; then
      echo "migration accepted simultaneous source and target" >&2
      exit 1
    fi
    grep -Fx collision "$legacy/sentinel"
    test -d "$migrated"

    cleanupTestHome
    renameSource="$testHome/rename-source"
    renameTarget="$testHome/rename-target"
    mkdir -p "$testHome"
    printf 'source\n' > "$renameSource"
    printf 'target\n' > "$renameTarget"
    if ${lib.getExe renameNoReplace} "$renameSource" "$renameTarget"; then
      echo "rename-no-replace overwrote an existing target" >&2
      exit 1
    fi
    grep -Fx source "$renameSource"
    grep -Fx target "$renameTarget"

    cleanupTestHome
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
