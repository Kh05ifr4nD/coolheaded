{ pkgs }:

let
  renameNoReplace = import ./renameNoReplace.nix { inherit pkgs; };
in
pkgs.writeShellApplication {
  name = "codex-home-migrate";
  runtimeInputs = [
    pkgs.coreutils
    pkgs.lsof
    pkgs.rsync
    renameNoReplace
  ];
  text = ''
    legacy="$1"
    target="$2"

    umask 077

    if [[ -L "$legacy" || -L "$target" ]]; then
      echo "Codex home migration refuses symbolic-link roots: $legacy -> $target" >&2
      exit 1
    fi
    if [[ -e "$target" ]]; then
      if [[ -e "$legacy" ]]; then
        echo "Codex home migration found both source and target; refusing to merge: $legacy, $target" >&2
        exit 1
      fi
      exit 0
    fi
    targetParent="$(dirname "$target")"
    if [[ -d "$targetParent" ]]; then
      shopt -s nullglob
      interruptedStages=("$targetParent"/.codex-home-migration.*)
      shopt -u nullglob
      if (( ''${#interruptedStages[@]} > 0 )); then
        echo "Codex home migration found staged data from an interrupted run; refusing to start another migration:" >&2
        printf '  %s\n' "''${interruptedStages[@]}" >&2
        exit 1
      fi
    fi
    if [[ ! -e "$legacy" ]]; then
      shopt -s nullglob
      interruptedBackups=("$legacy".backup-*)
      shopt -u nullglob
      if (( ''${#interruptedBackups[@]} > 0 )); then
        echo "Codex home migration found rollback data without a source or target; refusing to initialize a new home:" >&2
        printf '  %s\n' "''${interruptedBackups[@]}" >&2
        exit 1
      fi
      exit 0
    fi
    if [[ ! -d "$legacy" ]]; then
      echo "Legacy Codex home is not a directory: $legacy" >&2
      exit 1
    fi

    assertUnused() {
      path="$1"
      openFiles="$(mktemp "''${TMPDIR:-/tmp}/codex-home-open-files.XXXXXX")"
      diagnostics="$(mktemp "''${TMPDIR:-/tmp}/codex-home-lsof-diagnostics.XXXXXX")"
      if ! lsof -Q +D "$path" >"$openFiles" 2>"$diagnostics"; then
        cat "$diagnostics" >&2
        rm -f "$openFiles" "$diagnostics"
        echo "Unable to verify that the Codex home is unused: $path" >&2
        return 1
      fi
      if [[ -s "$diagnostics" ]]; then
        cat "$diagnostics" >&2
        rm -f "$openFiles" "$diagnostics"
        echo "Unable to verify that the Codex home is unused: $path" >&2
        return 1
      fi
      if [[ -s "$openFiles" ]]; then
        cat "$openFiles" >&2
        rm -f "$openFiles" "$diagnostics"
        echo "Close every process using the Codex home before migration: $path" >&2
        return 1
      fi
      rm -f "$openFiles" "$diagnostics"
    }

    assertUnused "$legacy"

    mkdir -p "$targetParent"
    stage="$(mktemp -d "$targetParent/.codex-home-migration.XXXXXX")"
    backup=""
    legacyMoved=""

    rollback() {
      result="$?"
      set +e
      if [[ -n "$legacyMoved" && ! -e "$legacy" && -d "$backup" ]]; then
        rename-no-replace "$backup" "$legacy"
      fi
      if [[ -n "$stage" && -d "$stage" ]]; then
        rm -rf "$stage"
      fi
      exit "$result"
    }
    trap rollback EXIT

    rsync -aHAX --protect-args "$legacy/" "$stage/"
    differences="$(rsync -aHAXnic --delete --protect-args "$legacy/" "$stage/")"
    if [[ -n "$differences" ]]; then
      printf '%s\n' "$differences" >&2
      echo "Staged Codex home failed content or metadata verification" >&2
      exit 1
    fi

    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup="$legacy.backup-$timestamp"
    if [[ -e "$backup" || -L "$backup" ]]; then
      echo "Codex home migration backup already exists: $backup" >&2
      exit 1
    fi

    rename-no-replace "$legacy" "$backup"
    legacyMoved=1
    assertUnused "$backup"
    differences="$(rsync -aHAXnic --delete --protect-args "$backup/" "$stage/")"
    if [[ -n "$differences" ]]; then
      printf '%s\n' "$differences" >&2
      echo "Legacy Codex home changed during migration; restoring its original path" >&2
      exit 1
    fi
    if [[ -e "$legacy" || -L "$legacy" ]]; then
      echo "Legacy Codex home reappeared during migration; refusing to activate the staged copy" >&2
      exit 1
    fi
    rename-no-replace "$stage" "$target"
    stage=""
    legacyMoved=""
    trap - EXIT

    printf 'Migrated Codex home to %s; preserved rollback copy at %s\n' "$target" "$backup"
  '';
}
