{
  pkgs,
  renameNoReplace ? import ./renameNoReplace.nix { inherit pkgs; },
  trustUnmappedOwnersForTests ? false,
}:

assert !trustUnmappedOwnersForTests || pkgs.stdenv.hostPlatform.isLinux;
pkgs.writeShellApplication {
  name = "codex-home-migrate";
  runtimeInputs = [
    pkgs.coreutils
    pkgs.lsof
    pkgs.rsync
    renameNoReplace
  ]
  ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isDarwin [ pkgs.darwin.file_cmds ]
  ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.acl ];
  text = ''
    usage() {
      printf 'Usage: codex-home-migrate LEGACY TARGET\n'
    }

    if (( $# == 1 )) && [[ "$1" == -h || "$1" == --help ]]; then
      usage
      exit 0
    fi
    if (( $# != 2 )); then
      usage >&2
      exit 64
    fi

    legacy="$1"
    target="$2"

    umask 077

    # The destination is always a fresh empty stage. --inplace lets rsync
    # finish a new file before applying a source ACL that may forbid renaming
    # its temporary file (for example, "deny delete").
    rsyncArgs=(-aHAX --protect-args --inplace)
    ${pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
      # macOS may attach this system-managed attribute to newly created files
      # and directories even when the source does not have it. It cannot be
      # made equal by rsync, so exclude only this attribute from copy and
      # comparison while preserving every other xattr.
      rsyncArgs+=(--filter "-x com.apple.provenance")
    ''}

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
    currentOwner="$(id -u)"
    ${pkgs.lib.optionalString trustUnmappedOwnersForTests ''
      # Nix's Linux sandbox can hide host owners behind overflowuid. This branch
      # is compiled only into test helpers; production must prove every owner.
      testOnlyUnmappedOwner=
      if [[ -r /proc/self/uid_map && -r /proc/sys/kernel/overflowuid ]]; then
        overflowUid="$(cat /proc/sys/kernel/overflowuid)"
        overflowUidMapped=
        while read -r insideUid _ rangeLength; do
          if (( overflowUid >= insideUid && overflowUid - insideUid < rangeLength )); then
            overflowUidMapped=1
            break
          fi
        done < /proc/self/uid_map
        if [[ -z "$overflowUidMapped" ]]; then
          testOnlyUnmappedOwner="$overflowUid"
        fi
      fi
    ''}
    targetName="$(basename "$target")"
    targetParent="$(realpath "$targetParent")"
    target="$targetParent/$targetName"

    assertNoWritableExtendedAcl() {
      directory="$1"
      ${pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
        currentUser="$(id -un)"
        if ! aclListing="$(${pkgs.darwin.file_cmds}/bin/ls -lde "$directory")"; then
          echo "Unable to inspect target-path ACLs: $directory" >&2
          return 1
        fi
        read -r permissions _ <<< "$aclListing"
        if [[ "$permissions" == *+ ]]; then
          while IFS= read -r aclEntry; do
            [[ "$aclEntry" == *" allow "* ]] || continue
            aclSubject="''${aclEntry%% allow *}"
            aclSubject="''${aclSubject#*: }"
            aclPrincipal="''${aclSubject%% *}"
            if [[ "$aclPrincipal" == "user:$currentUser" || "$aclPrincipal" == "user:root" ]]; then
              continue
            fi
            aclPermissions="''${aclEntry#* allow }"
            case ",$aclPermissions," in
              *,add_file,* | *,add_subdirectory,* | *,delete_child,* | *,delete,* | *,write,* | *,append,* | *,writeattr,* | *,writeextattr,* | *,writesecurity,* | *,chown,*)
                echo "Codex home migration refuses a writable extended ACL in the target path: $directory" >&2
                return 1
                ;;
            esac
          done <<< "$aclListing"
        fi
      ''}
      ${pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
        if ! aclListing="$(getfacl -cpn "$directory")"; then
          echo "Unable to inspect target-path ACLs: $directory" >&2
          return 1
        fi
        while IFS= read -r aclEntry; do
          case "$aclEntry" in
            "" | user::[r-][w-][x-] | group::[r-][w-][x-] | other::[r-][w-][x-] | mask::[r-][w-][x-]) ;;
            user:"$currentOwner":* | user:0:* | default:user:"$currentOwner":* | default:user:0:*) ;;
            *:*w*)
              echo "Codex home migration refuses a writable extended ACL in the target path: $directory" >&2
              return 1
              ;;
          esac
        done <<< "$aclListing"
      ''}
    }

    targetParentOwner="$(stat -c %u "$targetParent")"
    targetParentMode="$(stat -c %a "$targetParent")"
    if [[ "$targetParentOwner" != "$currentOwner" ]] || (( 8#$targetParentMode & 0022 )); then
      echo "Codex home migration requires a user-owned target parent without group or other write access: $targetParent" >&2
      exit 1
    fi
    assertNoWritableExtendedAcl "$targetParent"

    ancestor="$(dirname "$targetParent")"
    while :; do
      ancestorOwner="$(stat -c %u "$ancestor")"
      ancestorMode="$(stat -c %a "$ancestor")"
      trustedAncestorOwner=
      if [[ "$ancestorOwner" == "$currentOwner" || "$ancestorOwner" == 0 ]]; then
        trustedAncestorOwner=1
      ${pkgs.lib.optionalString trustUnmappedOwnersForTests ''
        elif [[ -n "$testOnlyUnmappedOwner" && "$ancestorOwner" == "$testOnlyUnmappedOwner" ]]; then
          trustedAncestorOwner=1
      ''}
      fi
      if [[ -z "$trustedAncestorOwner" ]]; then
        echo "Codex home migration refuses a target-path ancestor owned by another user: $ancestor" >&2
        exit 1
      fi
      if (( (8#$ancestorMode & 0022) && !(8#$ancestorMode & 01000) )); then
        echo "Codex home migration refuses a writable non-sticky target-path ancestor: $ancestor" >&2
        exit 1
      fi
      assertNoWritableExtendedAcl "$ancestor"
      [[ "$ancestor" == / ]] && break
      ancestor="$(dirname "$ancestor")"
    done

    stage="$(mktemp -d "$targetParent/.codex-home-migration.XXXXXX")"
    stageIdentity="$(stat -c %d:%i -- "$stage")"
    backup=""

    isPublishedTarget() {
      local targetIdentity
      [[ -n "$stageIdentity" && ! -L "$target" && -d "$target" ]] || return 1
      targetIdentity="$(stat -c %d:%i -- "$target")" || return 1
      [[ "$targetIdentity" == "$stageIdentity" ]]
    }

    rollback() {
      result="$?"
      set +e
      if [[ -n "$backup" && ! -e "$legacy" && -d "$backup" ]] && ! isPublishedTarget; then
        rename-no-replace "$backup" "$legacy"
      fi
      if [[ -n "$stage" && -d "$stage" ]]; then
        ${pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
          ${pkgs.darwin.file_cmds}/bin/chmod -RN "$stage" || true
        ''}
        chmod -R u+rwX "$stage" || true
        rm -rf "$stage"
      fi
      exit "$result"
    }
    trap rollback EXIT

    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup="$legacy.backup-$timestamp"
    if [[ -e "$backup" || -L "$backup" ]]; then
      echo "Codex home migration backup already exists: $backup" >&2
      exit 1
    fi

    rename-no-replace "$legacy" "$backup"
    assertUnused "$backup"
    # Copy only after the source path is frozen. This includes every completed
    # pre-rename write and reconstructs exact hard-link topology in an empty
    # stage; rsync --inplace cannot split stale destination hard links.
    rsync "''${rsyncArgs[@]}" "$backup/" "$stage/"
    differences="$(rsync "''${rsyncArgs[@]}" -nic --delete "$backup/" "$stage/")"
    if [[ -n "$differences" ]]; then
      printf '%s\n' "$differences" >&2
      echo "Staged Codex home failed content or metadata verification; restoring its original path" >&2
      exit 1
    fi
    if [[ -e "$legacy" || -L "$legacy" ]]; then
      echo "Legacy Codex home reappeared during migration; refusing to activate the staged copy" >&2
      exit 1
    fi
    rename-no-replace "$stage" "$target"
    trap - EXIT

    printf 'Migrated Codex home to %s; preserved rollback copy at %s\n' "$target" "$backup"
  '';
}
