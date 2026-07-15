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

  exchangePaths = import ../../lib/nix/exchangePaths.nix { inherit pkgs; };
  renameNoReplace = import ../../lib/nix/renameNoReplace.nix { inherit pkgs; };
  withFileLock = import ../../lib/nix/withFileLock.nix { inherit pkgs; };
  productionMigration = import ../../lib/nix/codexHomeMigrate.nix { inherit pkgs; };
  testMigration = import ../../lib/nix/codexHomeMigrate.nix {
    inherit pkgs;
    trustUnmappedOwnersForTests = pkgs.stdenv.hostPlatform.isLinux;
  };
  productionCodexModule = import ../../homeModules/codex.nix {
    self.packages.${system}.codex = package;
  };
  codexModule = import ../../homeModules/codex.nix {
    self.packages.${system}.codex = package;
    codexHomeMigrationPackage = testMigration;
  };
  bundledCodexModule = {
    key = "${fakeHomeManagerModulesPath}/programs/codex";
    options.programs.codex.enable = lib.mkOption { type = lib.types.str; };
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

  signalExchangePaths = pkgs.writeShellScriptBin "exchange-paths" ''
    set -euo pipefail

    stateFile="''${CODEX_HOME_MIGRATION_TEST_EXCHANGE_SIGNAL_STATE:?}"
    count=0
    if [[ -s "$stateFile" ]]; then
      read -r count < "$stateFile"
    fi
    count=$((count + 1))
    printf '%s\n' "$count" > "$stateFile"

    ${lib.getExe exchangePaths} "$@"
    if [[ "$count" == 1 ]]; then
      printf 'target-write-after-exchange\n' > "$1/state/after-exchange"
      kill -TERM "$PPID"
    fi
  '';

  exchangeSignalMigration = import ../../lib/nix/codexHomeMigrate.nix {
    inherit pkgs;
    exchangePaths = signalExchangePaths;
    trustUnmappedOwnersForTests = pkgs.stdenv.hostPlatform.isLinux;
  };

  killExchangePaths = pkgs.writeShellScriptBin "exchange-paths" ''
    set -euo pipefail

    ${lib.getExe exchangePaths} "$@"
    kill -KILL "$PPID"
  '';

  killExchangeMigration = import ../../lib/nix/codexHomeMigrate.nix {
    inherit pkgs;
    exchangePaths = killExchangePaths;
    trustUnmappedOwnersForTests = pkgs.stdenv.hostPlatform.isLinux;
  };

  partialLiveExchangePaths = pkgs.writeShellScriptBin "exchange-paths" ''
    set -euo pipefail

    if (( $# == 3 )); then
      ${lib.getExe exchangePaths} "$1" "$2"
      kill -KILL "$PPID"
      exit 1
    fi
    exec ${lib.getExe exchangePaths} "$@"
  '';

  partialLiveMigration = import ../../lib/nix/codexHomeMigrate.nix {
    inherit pkgs;
    exchangePaths = partialLiveExchangePaths;
    trustUnmappedOwnersForTests = pkgs.stdenv.hostPlatform.isLinux;
  };

  completedLiveExchangePaths = pkgs.writeShellScriptBin "exchange-paths" ''
    set -euo pipefail

    ${lib.getExe exchangePaths} "$@"
    if (( $# == 3 )); then
      kill -KILL "$PPID"
    fi
  '';

  completedLiveMigration = import ../../lib/nix/codexHomeMigrate.nix {
    inherit pkgs;
    exchangePaths = completedLiveExchangePaths;
    trustUnmappedOwnersForTests = pkgs.stdenv.hostPlatform.isLinux;
  };

  lateExchangePaths = pkgs.writeShellScriptBin "exchange-paths" ''
    set -euo pipefail

    printf 'late-write-before-exchange\n' > "$1/state/late-cutover"
    exec ${lib.getExe exchangePaths} "$@"
  '';

  lateExchangeMigration = import ../../lib/nix/codexHomeMigrate.nix {
    inherit pkgs;
    exchangePaths = lateExchangePaths;
    trustUnmappedOwnersForTests = pkgs.stdenv.hostPlatform.isLinux;
  };

  failingStageStat = pkgs.writeShellScript "codex-home-migration-failing-stage-stat" ''
    set -euo pipefail

    if (( $# == 4 )) && [[ "$1" == -c && "$2" == %d:%i && "$3" == -- && "$4" == */.codex-home-migration.* ]]; then
      exit 70
    fi
    exec ${pkgs.coreutils}/bin/stat "$@"
  '';

  stageFailureMigration = import ../../lib/nix/codexHomeMigrate.nix {
    inherit pkgs;
    statCommand = failingStageStat;
    trustUnmappedOwnersForTests = pkgs.stdenv.hostPlatform.isLinux;
  };

  zeroRootStat = pkgs.writeShellScript "codex-home-migration-zero-root-stat" ''
    set -euo pipefail

    if (( $# == 3 )) && [[ "$1" == -c && "$2" == %u && "$3" == / ]]; then
      printf '0\n'
      exit 0
    fi
    exec ${pkgs.coreutils}/bin/stat "$@"
  '';
  overflowUidZero = pkgs.writeText "codex-home-migration-overflowuid-zero" "0\n";
  zeroOverflowProductionMigration = import ../../lib/nix/codexHomeMigrate.nix {
    inherit pkgs;
    statCommand = zeroRootStat;
    overflowUidFile = overflowUidZero;
  };

  lateLockWriter =
    let
      source = pkgs.writeText "codex-home-migration-late-lock-writer.c" ''
        #if defined(__APPLE__)
        #define _DARWIN_C_SOURCE
        #else
        #define _DEFAULT_SOURCE
        #endif
        #define _POSIX_C_SOURCE 200809L

        #include <errno.h>
        #include <fcntl.h>
        #include <stdio.h>
        #include <string.h>
        #include <sys/file.h>
        #include <sys/stat.h>
        #include <time.h>
        #include <unistd.h>

        static int create_marker(const char *path) {
          int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, S_IRUSR | S_IWUSR);
          if (fd < 0) {
            fprintf(stderr, "late-lock-writer: create %s: %s\n", path, strerror(errno));
            return -1;
          }
          return close(fd);
        }

        int main(int argc, char **argv) {
          if (argc != 5) {
            fprintf(stderr, "usage: late-lock-writer LOCK DATA READY GO\n");
            return 2;
          }

          int lock_fd = open(argv[1], O_WRONLY | O_CREAT, S_IRUSR | S_IWUSR);
          if (lock_fd < 0) {
            fprintf(stderr, "late-lock-writer: open fixture: %s\n", strerror(errno));
            return 1;
          }
          if (create_marker(argv[3]) != 0) {
            return 1;
          }
          while (access(argv[4], F_OK) != 0) {
            struct timespec delay = {.tv_sec = 0, .tv_nsec = 1000000};
            while (nanosleep(&delay, &delay) != 0 && errno == EINTR) {}
          }
          if (flock(lock_fd, LOCK_EX) != 0) {
            fprintf(stderr, "late-lock-writer: lock: %s\n", strerror(errno));
            return 1;
          }
          int data_fd = open(argv[2], O_WRONLY | O_CREAT | O_TRUNC, S_IRUSR | S_IWUSR);
          if (data_fd < 0) {
            fprintf(stderr, "late-lock-writer: open data after lock: %s\n", strerror(errno));
            return 1;
          }
          if (write(data_fd, "after\n", 6) != 6 || fsync(data_fd) != 0) {
            fprintf(stderr, "late-lock-writer: write data: %s\n", strerror(errno));
            return 1;
          }
          return 0;
        }
      '';
    in
    pkgs.runCommandCC "codex-home-migration-late-lock-writer" { meta.mainProgram = "late-lock-writer"; }
      ''
        mkdir -p "$out/bin"
        $CC -std=c11 -O2 -Wall -Wextra -Werror \
          ${source} \
          -o "$out/bin/late-lock-writer"
      '';

  lateWriterLsof = pkgs.writeShellScriptBin "lsof" ''
    set -euo pipefail

    countFile="''${CODEX_HOME_MIGRATION_LATE_WRITER_COUNT:?}"
    count=0
    if [[ -s "$countFile" ]]; then
      read -r count < "$countFile"
    fi
    count=$((count + 1))
    printf '%s\n' "$count" > "$countFile"
    if [[ "$count" == 2 ]]; then
      touch "''${CODEX_HOME_MIGRATION_LATE_WRITER_GO:?}"
    fi
  '';

  delayedRsync = pkgs.writeShellScriptBin "rsync" ''
    set -euo pipefail

    if mkdir "''${CODEX_HOME_MIGRATION_DELAYED_RSYNC_ONCE:?}" 2>/dev/null; then
      sleep 1
    fi
    exec ${lib.getExe pkgs.rsync} "$@"
  '';

  lateWriterMigration = import ../../lib/nix/codexHomeMigrate.nix {
    pkgs = pkgs // {
      lsof = lateWriterLsof;
      rsync = delayedRsync;
    };
    trustUnmappedOwnersForTests = pkgs.stdenv.hostPlatform.isLinux;
  };

  verificationMismatchRsync = pkgs.writeShellScriptBin "rsync" ''
    set -euo pipefail

    ${lib.getExe pkgs.rsync} "$@"
    for argument in "$@"; do
      if [[ "$argument" == -nic ]]; then
        printf '>f+++++++++ forced-verification-difference\n'
        break
      fi
    done
  '';

  cleanupNoiseMigration = import ../../lib/nix/codexHomeMigrate.nix {
    pkgs = pkgs // {
      rsync = verificationMismatchRsync;
    };
    trustUnmappedOwnersForTests = pkgs.stdenv.hostPlatform.isLinux;
  };

  gitLensRenameNoReplace = pkgs.writeShellScriptBin "rename-no-replace" ''
    set -euo pipefail

    if [[ "$(dirname "$1")" == "$(dirname "$2")" ]]; then
      echo "migration exposed its private stage beside the target" >&2
      exit 1
    fi
    mkdir -p "$1/.tmp/plugins/.git/gk"
    : > "$1/.tmp/plugins/.git/gk/config"
    : > "$1/.tmp/plugins/.git/FETCH_HEAD"
    exec ${lib.getExe renameNoReplace} "$@"
  '';

  gitLensMigration = import ../../lib/nix/codexHomeMigrate.nix {
    inherit pkgs;
    renameNoReplace = gitLensRenameNoReplace;
    trustUnmappedOwnersForTests = pkgs.stdenv.hostPlatform.isLinux;
  };

  moduleEvaluation = lib.evalModules {
    specialArgs = {
      inherit pkgs;
      modulesPath = fakeHomeManagerModulesPath;
    };
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
      })
      bundledCodexModule
      codexModule
      {
        home.homeDirectory = testHome;
        home.preferXdgDirectories = true;
        xdg.configHome = "${testHome}/.config";

        programs.codex = {
          enable = true;
          settings = {
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

  mkMigrationEvaluation =
    module:
    lib.evalModules {
      specialArgs = { inherit pkgs; };
      modules = [
        ({ lib, ... }: {
          options = {
            assertions = lib.mkOption {
              type = lib.types.listOf lib.types.raw;
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
        })
        module
        {
          home = {
            homeDirectory = testHome;
            preferXdgDirectories = true;
          };
          xdg.configHome = "${testHome}/.config";
          programs.codex.enable = true;
        }
      ];
    };
  migrationEvaluation = mkMigrationEvaluation codexModule;
  productionMigrationEvaluation = mkMigrationEvaluation productionCodexModule;

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

  productionMigrationScript = pkgs.writeShellScript "migrate-codex-home-module-production" ''
    set -euo pipefail

    run() {
      "$@"
    }

    ${productionMigrationEvaluation.config.home.activation.codexHomeMigration.data}
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
    shopt -s nullglob
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
    grep -F ${lib.escapeShellArg (lib.getExe productionMigration)} ${productionMigrationScript}
    if grep -F "Close every process" ${lib.getExe productionMigration}; then
      echo "migration delegates process shutdown to the user" >&2
      exit 1
    fi
    ${lib.getExe productionMigration} --help >"$TMPDIR/migration-help.out"
    grep -F "Usage: codex-home-migrate LEGACY TARGET" "$TMPDIR/migration-help.out"
    assertUsageError() {
      set +e
      ${lib.getExe productionMigration} "$@" \
        >"$TMPDIR/migration-invalid.out" 2>"$TMPDIR/migration-invalid.err"
      invalidStatus="$?"
      set -e
      test "$invalidStatus" = 64
      grep -F "Usage: codex-home-migrate LEGACY TARGET" "$TMPDIR/migration-invalid.err"
    }
    assertUsageError
    assertUsageError only-one-argument
    assertUsageError one two three
    target="$testHome/.config/codex/config.toml"
    cleanupTestHome() {
      ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
        if [[ -d "$testHome" ]]; then
        ${pkgs.darwin.file_cmds}/bin/chmod -f -RN "$testHome" || true
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
      mkdir -p "$legacy/state"
      printf 'zero-overflow-root\n' > "$legacy/state/sentinel"
      if ${lib.getExe zeroOverflowProductionMigration} "$legacy" "$migrated" \
        >"$TMPDIR/zero-overflow.out" 2>"$TMPDIR/zero-overflow.err"; then
        echo "production migration trusted root represented by overflowuid 0" >&2
        exit 1
      fi
      grep -F "refuses an ambiguous overflow UID owner: /" "$TMPDIR/zero-overflow.err"
      grep -Fx zero-overflow-root "$legacy/state/sentinel"
      test ! -e "$migrated"
      cleanupTestHome

      if [[ "$(stat -c %u /)" != 0 ]]; then
        mkdir -p "$legacy/state"
        printf 'unmapped-root\n' > "$legacy/state/sentinel"
        if ${lib.getExe productionMigration} "$legacy" "$migrated" \
          >"$TMPDIR/unmapped-root.out" 2>"$TMPDIR/unmapped-root.err"; then
          echo "production migration trusted an unmapped root owner" >&2
          exit 1
        fi
        grep -F "refuses an ambiguous overflow UID owner: /" "$TMPDIR/unmapped-root.err"
        grep -Fx unmapped-root "$legacy/state/sentinel"
        test ! -e "$migrated"
        cleanupTestHome
      fi
    ''}
    mkdir -p "$legacy"
    printf 'before\n' > "$legacy/open-session"
    exec 9>>"$legacy/open-session"
    "$migrationUnderTest"
    printf 'after\n' >&9
    exec 9>&-
    test -L "$legacy"
    test "$(realpath "$legacy")" = "$(realpath "$migrated")"
    grep -Fx before "$migrated/open-session"
    grep -Fx after "$migrated/open-session"

    cleanupTestHome
    mkdir -p "$legacy/state" "$(dirname "$migrated")"
    printf 'before-preparation-recovery\n' > "$legacy/state/session"
    exec 9>>"$legacy/state/session"
    preparationRedirect="$(realpath -ms --relative-to="$(dirname "$legacy")" "$migrated")"
    ln -s "$preparationRedirect" "$legacy.migration-pending"
    "$migrationUnderTest"
    printf 'after-preparation-recovery\n' >&9
    exec 9>&-
    test -L "$legacy"
    test -d "$migrated"
    test ! -e "$legacy.migration-pending"
    grep -Fx before-preparation-recovery "$migrated/state/session"
    grep -Fx after-preparation-recovery "$migrated/state/session"

    cleanupTestHome
    mkdir -p "$legacy/state"
    printf 'before-interruption\n' > "$legacy/state/session"
    exec 9>>"$legacy/state/session"
    if ${lib.getExe partialLiveMigration} "$legacy" "$migrated"; then
      echo "migration ignored a process death between live path exchanges" >&2
      exit 1
    fi
    test -L "$legacy"
    test -L "$migrated"
    test -d "$legacy.migration-pending"
    "$migrationUnderTest"
    printf 'after-recovery\n' >&9
    exec 9>&-
    test -L "$legacy"
    test -d "$migrated"
    test ! -L "$migrated"
    test ! -e "$legacy.migration-pending"
    grep -Fx before-interruption "$migrated/state/session"
    grep -Fx after-recovery "$migrated/state/session"

    cleanupTestHome
    mkdir -p "$legacy/state"
    printf 'before-completed-interruption\n' > "$legacy/state/session"
    exec 9>>"$legacy/state/session"
    if ${lib.getExe completedLiveMigration} "$legacy" "$migrated"; then
      echo "migration ignored a process death after live path exchanges" >&2
      exit 1
    fi
    test -L "$legacy"
    test -d "$migrated"
    test -L "$legacy.migration-pending"
    "$migrationUnderTest"
    printf 'after-completed-recovery\n' >&9
    exec 9>&-
    test -L "$legacy"
    test -d "$migrated"
    test ! -e "$legacy.migration-pending"
    grep -Fx before-completed-interruption "$migrated/state/session"
    grep -Fx after-completed-recovery "$migrated/state/session"

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
    lateWriterLock="$legacy/.tmp/plugins.sync.lock"
    lateWriterData="$legacy/.tmp/plugins/startup-sync-state"
    lateWriterReady="$TMPDIR/codex-home-late-writer.ready"
    lateWriterGo="$TMPDIR/codex-home-late-writer.go"
    lateWriterCount="$TMPDIR/codex-home-late-writer.count"
    delayedRsyncOnce="$TMPDIR/codex-home-delayed-rsync.once"
    mkdir -p "$(dirname "$lateWriterData")"
    printf 'before\n' > "$lateWriterData"
    rm -f "$lateWriterReady" "$lateWriterGo" "$lateWriterCount"
    rm -rf "$delayedRsyncOnce"
    ${pkgs.coreutils}/bin/timeout 15s ${lib.getExe lateLockWriter} \
      "$lateWriterLock" "$lateWriterData" "$lateWriterReady" "$lateWriterGo" &
    lateWriterPid="$!"
    for _ in {1..1000}; do
      [[ -e "$lateWriterReady" ]] && break
      sleep 0.01
    done
    if [[ ! -e "$lateWriterReady" ]]; then
      echo "timed out waiting for the late Codex plugin writer" >&2
      exit 1
    fi
    CODEX_HOME_MIGRATION_LATE_WRITER_COUNT="$lateWriterCount" \
      CODEX_HOME_MIGRATION_LATE_WRITER_GO="$lateWriterGo" \
    CODEX_HOME_MIGRATION_DELAYED_RSYNC_ONCE="$delayedRsyncOnce" \
      ${lib.getExe lateWriterMigration} "$legacy" "$migrated"
    wait "$lateWriterPid"
    test -L "$legacy"
    test "$(readlink "$legacy")" = .config/codex
    test "$(realpath "$legacy")" = "$(realpath "$migrated")"
    grep -Fx after "$migrated/.tmp/plugins/startup-sync-state"
    lateWriterBackups=("$legacy".backup-*)
    test "''${#lateWriterBackups[@]}" = 1
    grep -Fx before "''${lateWriterBackups[0]}/.tmp/plugins/startup-sync-state"
    test "$(stat -c %d:%i "$migrated/.tmp/plugins.sync.lock")" = \
      "$(stat -c %d:%i "''${lateWriterBackups[0]}/.tmp/plugins.sync.lock")"
    ${lib.getExe withFileLock} "$TMPDIR/codex-home-helper.lock" true

    cleanupTestHome
    mkdir -p "$legacy/.tmp/plugins/.git"
    printf 'preserved-in-backup\n' > "$legacy/.tmp/plugins/.git/FETCH_HEAD"
    printf 'preserved-checkout\n' > "$legacy/.tmp/plugins/marketplace"
    ${lib.getExe gitLensMigration} "$legacy" "$migrated"
    test -L "$legacy"
    grep -Fx preserved-checkout "$migrated/.tmp/plugins/marketplace"
    test -f "$migrated/.tmp/plugins/.git/gk/config"
    test ! -s "$migrated/.tmp/plugins/.git/FETCH_HEAD"
    gitLensBackups=("$legacy".backup-*)
    test "''${#gitLensBackups[@]}" = 1
    grep -Fx preserved-in-backup "''${gitLensBackups[0]}/.tmp/plugins/.git/FETCH_HEAD"

    cleanupTestHome
    mkdir -p "$legacy/state"
    printf 'cleanup-source\n' > "$legacy/state/sentinel"
    ln -s missing-target "$legacy/apply_patch"
    if ${lib.getExe cleanupNoiseMigration} "$legacy" "$migrated" \
      >"$TMPDIR/cleanup-noise.out" 2>"$TMPDIR/cleanup-noise.err"; then
      echo "migration ignored a forced staged-verification mismatch" >&2
      exit 1
    fi
    grep -F "Staged Codex home failed content or metadata verification" "$TMPDIR/cleanup-noise.err"
    if grep -F "Failed to clear ACL" "$TMPDIR/cleanup-noise.err"; then
      echo "migration emitted recursive ACL cleanup noise for a symbolic link" >&2
      exit 1
    fi
    grep -Fx cleanup-source "$legacy/state/sentinel"
    test ! -e "$migrated"
    cleanupNoiseStages=("$(dirname "$migrated")"/.codex-home-migration.*)
    test "''${#cleanupNoiseStages[@]}" = 0

    cleanupTestHome
    mkdir -p "$legacy/.tmp"
    touch "$legacy/.tmp/plugins.sync.lock" "$legacy/held-by-parent"
    exec 9>"$legacy/held-by-parent"
    if CODEX_HOME_MIGRATION_LOCK_FD=9 "$migrationUnderTest" \
      >"$TMPDIR/forged-lock.out" 2>"$TMPDIR/forged-lock.err"; then
      echo "migration trusted a forged inherited lock descriptor" >&2
      exit 1
    fi
    exec 9>&-
    grep -F "invalid locked descriptor" "$TMPDIR/forged-lock.err"
    test -d "$legacy"
    test ! -e "$migrated"

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
    interruptedBackup="$legacy.backup-interrupted"
    mkdir -p "$legacy/state" "$interruptedBackup/state"
    printf 'recreated-source\n' > "$legacy/state/sentinel"
    printf 'original-rollback\n' > "$interruptedBackup/state/sentinel"
    if "$migrationUnderTest" >"$TMPDIR/source-and-rollback.out" 2>"$TMPDIR/source-and-rollback.err"; then
      echo "migration chose between a recreated source and rollback data" >&2
      exit 1
    fi
    grep -F "Codex home migration found source and rollback data without a target" "$TMPDIR/source-and-rollback.err"
    grep -F "$interruptedBackup" "$TMPDIR/source-and-rollback.err"
    grep -Fx recreated-source "$legacy/state/sentinel"
    grep -Fx original-rollback "$interruptedBackup/state/sentinel"
    test ! -e "$migrated"

    cleanupTestHome
    mkdir -p "$legacy/state"
    printf 'stage-identity-failure\n' > "$legacy/state/sentinel"
    stageFailureLegacyIdentity="$(stat -c %d:%i "$legacy")"
    if ${lib.getExe stageFailureMigration} "$legacy" "$migrated" \
      >"$TMPDIR/stage-failure.out" 2>"$TMPDIR/stage-failure.err"; then
      echo "migration ignored failure while recording the stage identity" >&2
      exit 1
    fi
    test "$(stat -c %d:%i "$legacy")" = "$stageFailureLegacyIdentity"
    grep -Fx stage-identity-failure "$legacy/state/sentinel"
    test ! -e "$migrated"
    failedStages=("$(dirname "$migrated")"/.codex-home-migration.*)
    test "''${#failedStages[@]}" = 0

    cleanupTestHome
    mkdir -p "$legacy/state"
    printf 'first-rename\n' > "$legacy/state/sentinel"
    firstSignalLegacyIdentity="$(stat -c %d:%i "$legacy")"
    signalState="$TMPDIR/codex-home-signal-state"
    rm -f "$signalState"
    if CODEX_HOME_MIGRATION_TEST_SIGNAL_STATE="$signalState" \
      CODEX_HOME_MIGRATION_TEST_SIGNAL_AFTER=1 \
      ${lib.getExe signalMigration} "$legacy" "$migrated"; then
      echo "migration ignored TERM immediately after the source rename" >&2
      exit 1
    fi
    if [[ "$(stat -c %d:%i "$legacy")" != "$firstSignalLegacyIdentity" ]]; then
      echo "source identity changed after interrupted target publication" >&2
      exit 1
    fi
    grep -Fx first-rename "$legacy/state/sentinel"
    if [[ ! -d "$migrated" || -L "$migrated" ]]; then
      echo "published target was not preserved after interruption: $migrated" >&2
      exit 1
    fi
    grep -Fx first-rename "$migrated/state/sentinel"
    firstSignalBackups=("$legacy".backup-*)
    test "''${#firstSignalBackups[@]}" = 1
    test -L "''${firstSignalBackups[0]}"
    test "$(realpath "''${firstSignalBackups[0]}")" = "$(realpath "$migrated")"
    firstSignalPending=("$(dirname "$migrated")"/.codex-home-migration.pending-*)
    test "''${#firstSignalPending[@]}" = 1

    cleanupTestHome
    mkdir -p "$legacy/state"
    printf 'exchange-signal\n' > "$legacy/state/sentinel"
    exchangeSignalLegacyIdentity="$(stat -c %d:%i "$legacy")"
    exchangeSignalState="$TMPDIR/codex-home-exchange-signal-state"
    rm -f "$exchangeSignalState"
    if CODEX_HOME_MIGRATION_TEST_EXCHANGE_SIGNAL_STATE="$exchangeSignalState" \
      ${lib.getExe exchangeSignalMigration} "$legacy" "$migrated"; then
      echo "migration ignored TERM immediately after the atomic redirect exchange" >&2
      exit 1
    fi
    test -L "$legacy"
    test "$(realpath "$legacy")" = "$(realpath "$migrated")"
    grep -Fx exchange-signal "$migrated/state/sentinel"
    grep -Fx target-write-after-exchange "$migrated/state/after-exchange"
    exchangeSignalBackups=("$legacy".backup-*)
    test "''${#exchangeSignalBackups[@]}" = 1
    test "$(stat -c %d:%i "''${exchangeSignalBackups[0]}")" = "$exchangeSignalLegacyIdentity"
    grep -Fx exchange-signal "''${exchangeSignalBackups[0]}/state/sentinel"
    test ! -e "''${exchangeSignalBackups[0]}/state/after-exchange"
    exchangeSignalPending=("$(dirname "$migrated")"/.codex-home-migration.pending-*)
    test "''${#exchangeSignalPending[@]}" = 1

    cleanupTestHome
    mkdir -p "$legacy/state"
    printf 'kill-after-exchange\n' > "$legacy/state/sentinel"
    killExchangeLegacyIdentity="$(stat -c %d:%i "$legacy")"
    if ${lib.getExe killExchangeMigration} "$legacy" "$migrated"; then
      echo "migration ignored KILL immediately after the atomic exchange" >&2
      exit 1
    fi
    test -L "$legacy"
    test "$(realpath "$legacy")" = "$(realpath "$migrated")"
    killExchangeBackups=("$legacy".backup-*)
    test "''${#killExchangeBackups[@]}" = 1
    test "$(stat -c %d:%i "''${killExchangeBackups[0]}")" = "$killExchangeLegacyIdentity"
    grep -Fx kill-after-exchange "''${killExchangeBackups[0]}/state/sentinel"
    killExchangePending=("$(dirname "$migrated")"/.codex-home-migration.pending-*)
    test "''${#killExchangePending[@]}" = 1
    if "$migrationUnderTest" >"$TMPDIR/kill-retry.out" 2>"$TMPDIR/kill-retry.err"; then
      echo "migration silently accepted a KILL-interrupted commit" >&2
      exit 1
    fi
    grep -F "Codex home migration found staged data from an interrupted run" "$TMPDIR/kill-retry.err"

    cleanupTestHome
    mkdir -p "$legacy/state"
    printf 'late-cutover-source\n' > "$legacy/state/sentinel"
    lateCutoverLegacyIdentity="$(stat -c %d:%i "$legacy")"
    if ${lib.getExe lateExchangeMigration} "$legacy" "$migrated" \
      >"$TMPDIR/late-cutover.out" 2>"$TMPDIR/late-cutover.err"; then
      echo "migration accepted a write after staged verification" >&2
      exit 1
    fi
    grep -F "Codex home changed during atomic cutover" "$TMPDIR/late-cutover.err"
    test -L "$legacy"
    test "$(realpath "$legacy")" = "$(realpath "$migrated")"
    test ! -e "$migrated/state/late-cutover"
    lateCutoverBackups=("$legacy".backup-*)
    test "''${#lateCutoverBackups[@]}" = 1
    test "$(stat -c %d:%i "''${lateCutoverBackups[0]}")" = "$lateCutoverLegacyIdentity"
    grep -Fx late-write-before-exchange "''${lateCutoverBackups[0]}/state/late-cutover"
    lateCutoverPending=("$(dirname "$migrated")"/.codex-home-migration.pending-*)
    test "''${#lateCutoverPending[@]}" = 1

    cleanupTestHome
    mkdir -p "$legacy/state"
    install -m 600 ${initialConfig} "$legacy/config.toml"
    printf 'session\n' > "$legacy/state/session"
    ln "$legacy/state/session" "$legacy/state/session-hardlink"
    ln -s session "$legacy/state/session-symlink"
    migrationLegacyIdentity="$(stat -c %d:%i "$legacy")"

    "$migrationUnderTest"
    test -L "$legacy"
    test "$(readlink "$legacy")" = .config/codex
    test "$(realpath "$legacy")" = "$(realpath "$migrated")"
    test -d "$migrated"
    diff -u ${initialConfig} "$migrated/config.toml"
    test "$(stat -c %a "$migrated/config.toml")" = 600
    test "$(stat -c %i "$migrated/state/session")" = "$(stat -c %i "$migrated/state/session-hardlink")"
    test "$(readlink "$migrated/state/session-symlink")" = session
    backups=("$legacy".backup-*)
    test "''${#backups[@]}" = 1
    test -d "''${backups[0]}"
    test "$(stat -c %d:%i "''${backups[0]}")" = "$migrationLegacyIdentity"

    "$migrationUnderTest"
    repeatedBackups=("$legacy".backup-*)
    test "''${#repeatedBackups[@]}" = 1

    rm "$legacy"
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
