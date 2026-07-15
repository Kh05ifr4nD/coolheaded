{
  pkgs,
  exchangePaths ? import ./exchangePaths.nix { inherit pkgs; },
  renameNoReplace ? import ./renameNoReplace.nix { inherit pkgs; },
  withFileLock ? import ./withFileLock.nix { inherit pkgs; },
  statCommand ? "${pkgs.coreutils}/bin/stat",
  overflowUidFile ? "/proc/sys/kernel/overflowuid",
  trustUnmappedOwnersForTests ? false,
}:

assert !trustUnmappedOwnersForTests || pkgs.stdenv.hostPlatform.isLinux;
pkgs.writeShellApplication {
  name = "codex-home-migrate";
  runtimeInputs = [
    pkgs.coreutils
    pkgs.lsof
    pkgs.rsync
    exchangePaths
    renameNoReplace
    withFileLock
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
    statCommand=${pkgs.lib.escapeShellArg statCommand}

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

    targetParent="$(dirname "$target")"
    livePending="$legacy.migration-pending"
    redirectTarget="$(realpath -ms --relative-to="$(dirname "$legacy")" "$target")"
    pendingFromTarget="$(realpath -ms --relative-to="$targetParent" "$livePending")"
    preparedLive=
    preparedPendingOnly=
    interruptedLive=
    completedLive=
    if [[ ! -L "$legacy" && -d "$legacy" \
      && ! -e "$target" && ! -L "$target" \
      && -L "$livePending" \
      && "$(readlink "$livePending")" == "$redirectTarget" ]]; then
      preparedPendingOnly=1
    elif [[ -L "$legacy" \
      && "$(readlink "$legacy")" == "$redirectTarget" \
      && -d "$target" && ! -L "$target" \
      && -L "$livePending" \
      && "$(readlink "$livePending")" == "$pendingFromTarget" ]]; then
      completedLive=1
    fi
    if [[ -L "$target" ]]; then
      if [[ ! -L "$legacy" && -d "$legacy" \
        && -L "$livePending" \
        && "$(readlink "$livePending")" == "$redirectTarget" \
        && "$(readlink "$target")" == "$pendingFromTarget" ]]; then
        preparedLive=1
      elif [[ -L "$legacy" \
        && "$(readlink "$legacy")" == "$redirectTarget" \
        && -d "$livePending" && ! -L "$livePending" \
        && "$(readlink "$target")" == "$pendingFromTarget" ]]; then
        interruptedLive=1
      else
        echo "Codex home migration refuses a symbolic-link target: $target" >&2
        exit 1
      fi
    fi
    if [[ -n "$completedLive" ]]; then
      rm -f "$livePending"
      if [[ ! -L "$legacy" || ! -d "$target" || -L "$target" \
        || "$(realpath "$legacy")" != "$(realpath "$target")" ]]; then
        echo "Codex home migration could not finish its interrupted live cutover" >&2
        exit 1
      fi
      printf 'Finished live Codex home at %s; redirected %s to the same directory\n' \
        "$target" "$legacy"
      exit 0
    fi
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
    if [[ -e "$target" && -z "$interruptedLive" ]]; then
      if [[ -L "$legacy" ]]; then
        if [[ "$(realpath "$legacy")" == "$(realpath "$target")" ]]; then
          exit 0
        fi
        echo "Codex home migration found an unrelated legacy symbolic link: $legacy" >&2
        exit 1
      fi
      if [[ -e "$legacy" ]]; then
        echo "Codex home migration found both source and target; refusing to merge: $legacy, $target" >&2
        exit 1
      fi
      exit 0
    fi
    if [[ -L "$legacy" && -z "$interruptedLive" ]]; then
      echo "Codex home migration refuses a symbolic-link source without its target: $legacy" >&2
      exit 1
    fi
    shopt -s nullglob
    interruptedBackups=("$legacy".backup-*)
    shopt -u nullglob
    if (( ''${#interruptedBackups[@]} > 0 )); then
      if [[ -e "$legacy" || -L "$legacy" ]]; then
        echo "Codex home migration found source and rollback data without a target; refusing to choose between them:" >&2
      else
        echo "Codex home migration found rollback data without a source or target; refusing to initialize a new home:" >&2
      fi
      printf '  %s\n' "''${interruptedBackups[@]}" >&2
      exit 1
    fi
    if [[ ! -e "$legacy" ]]; then
      exit 0
    fi
    if [[ ! -d "$legacy" ]]; then
      echo "Legacy Codex home is not a directory: $legacy" >&2
      exit 1
    fi

    lockFd="''${CODEX_HOME_MIGRATION_LOCK_FD:-}"
    if [[ -n "$lockFd" && ! "$lockFd" =~ ^[0-9]+$ ]]; then
      echo "Codex home migration received an invalid lock descriptor" >&2
      exit 1
    fi
    lockPath="$legacy/.tmp/plugins.sync.lock"
    if [[ -n "$lockFd" ]]; then
      with-file-lock --validate "$lockFd" "$lockPath"
    fi

    detectSourceUsage() {
      path="$1"
      sourceInUse=
      openFiles="$(mktemp "''${TMPDIR:-/tmp}/codex-home-open-files.XXXXXX")"
      diagnostics="$(mktemp "''${TMPDIR:-/tmp}/codex-home-lsof-diagnostics.XXXXXX")"
      lsofArgs=(-Q +D "$path")
      if [[ -n "$lockFd" ]]; then
        lsofArgs=(-Q -a -p "^$$" +D "$path")
      fi
      if ! (
        if [[ -n "$lockFd" ]]; then
          exec {lockFd}>&-
        fi
        exec lsof "''${lsofArgs[@]}"
      ) >"$openFiles" 2>"$diagnostics"; then
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
        sourceInUse=1
      fi
      rm -f "$openFiles" "$diagnostics"
    }

    assertUnusedExceptStartupLock() {
      path="$1"
      openFiles="$(mktemp "''${TMPDIR:-/tmp}/codex-home-open-files.XXXXXX")"
      diagnostics="$(mktemp "''${TMPDIR:-/tmp}/codex-home-lsof-diagnostics.XXXXXX")"
      if ! (
        exec {lockFd}>&-
        exec lsof -Q -a -p "^$$" -Fn +D "$path"
      ) >"$openFiles" 2>"$diagnostics"; then
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
      unsafeOpenFiles=
      while IFS= read -r field; do
        [[ "$field" == n* ]] || continue
        openPath="''${field#n}"
        case "$openPath" in
          "$legacy/.tmp/plugins.sync.lock" | "$target/.tmp/plugins.sync.lock" | "$backup/.tmp/plugins.sync.lock") ;;
          */.git | */.git/*) ;;
          *)
            unsafeOpenFiles+="$openPath"$'\n'
            ;;
        esac
      done < "$openFiles"
      rm -f "$openFiles" "$diagnostics"
      if [[ -n "$unsafeOpenFiles" ]]; then
        printf '%s' "$unsafeOpenFiles" >&2
        echo "Codex data remained active during copy-based cutover: $path" >&2
        return 1
      fi
    }

    mkdir -p "$targetParent"
    currentOwner="$(id -u)"
    ambiguousOwner=
    ${pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
      if [[ ! -r ${pkgs.lib.escapeShellArg overflowUidFile} ]] \
        || ! IFS= read -r ambiguousOwner < ${pkgs.lib.escapeShellArg overflowUidFile} \
        || [[ ! "$ambiguousOwner" =~ ^[0-9]+$ ]]; then
        echo "Unable to determine the Linux overflow UID representation" >&2
        exit 1
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

    targetParentOwner="$("$statCommand" -c %u "$targetParent")"
    targetParentMode="$("$statCommand" -c %a "$targetParent")"
    if [[ -n "$ambiguousOwner" && "$targetParentOwner" == "$ambiguousOwner" ]]; then
      echo "Codex home migration refuses an ambiguous overflow UID owner: $targetParent" >&2
      exit 1
    fi
    if [[ "$targetParentOwner" != "$currentOwner" ]] || (( 8#$targetParentMode & 0022 )); then
      echo "Codex home migration requires a user-owned target parent without group or other write access: $targetParent" >&2
      exit 1
    fi
    assertNoWritableExtendedAcl "$targetParent"

    ancestor="$(dirname "$targetParent")"
    while :; do
      ancestorOwner="$("$statCommand" -c %u "$ancestor")"
      ancestorMode="$("$statCommand" -c %a "$ancestor")"
      trustedAncestorOwner=
      if [[ -n "$ambiguousOwner" && "$ancestorOwner" == "$ambiguousOwner" ]]; then
        :
        ${pkgs.lib.optionalString trustUnmappedOwnersForTests ''
          # Nix's Linux sandbox can represent a host-owned ancestor as
          # overflowuid. Only generated test helpers accept it.
          trustedAncestorOwner=1
        ''}
      elif [[ "$ancestorOwner" == "$currentOwner" || "$ancestorOwner" == 0 ]]; then
        trustedAncestorOwner=1
      fi
      if [[ -z "$trustedAncestorOwner" ]]; then
        if [[ -n "$ambiguousOwner" && "$ancestorOwner" == "$ambiguousOwner" ]]; then
          echo "Codex home migration refuses an ambiguous overflow UID owner: $ancestor" >&2
        else
          echo "Codex home migration refuses a target-path ancestor owned by another user: $ancestor" >&2
        fi
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

    if [[ -z "$lockFd" ]]; then
      mkdir -p "$legacy/.tmp"
      exec with-file-lock \
        "$lockPath" \
        "$0" "$legacy" "$target"
    fi

    if [[ -n "$preparedLive" || -n "$preparedPendingOnly" ]]; then
      rm -f "$target" "$livePending"
      preparedLive=
      preparedPendingOnly=
    fi
    if [[ -n "$interruptedLive" ]]; then
      legacyIdentity="$("$statCommand" -c %d:%i -- "$livePending")"
      exchange-paths "$target" "$livePending"
      rm -f "$livePending"
      if [[ ! -L "$legacy" || ! -d "$target" || -L "$target" \
        || "$(realpath "$legacy")" != "$(realpath "$target")" \
        || "$("$statCommand" -c %d:%i -- "$target")" != "$legacyIdentity" ]]; then
        echo "Codex home migration could not recover its interrupted live cutover" >&2
        exit 1
      fi
      printf 'Recovered live Codex home at %s; redirected %s to the same directory\n' \
        "$target" "$legacy"
      exit 0
    fi

    detectSourceUsage "$legacy"
    if [[ -n "$sourceInUse" ]]; then
      legacyOwner="$("$statCommand" -c %u "$legacy")"
      if [[ "$legacyOwner" != "$currentOwner" ]]; then
        echo "Codex home migration refuses a source owned by another user: $legacy" >&2
        exit 1
      fi
      if [[ "$("$statCommand" -c %d "$legacy")" != "$("$statCommand" -c %d "$targetParent")" ]]; then
        echo "Codex home migration requires source and target on one filesystem: $legacy, $target" >&2
        exit 1
      fi

      livePending="$legacy.migration-pending"
      if [[ -e "$livePending" || -L "$livePending" ]]; then
        echo "Codex home migration found an interrupted live migration: $livePending" >&2
        exit 1
      fi
      legacyIdentity="$("$statCommand" -c %d:%i -- "$legacy")"
      redirectTarget="$(realpath -ms --relative-to="$(dirname "$legacy")" "$target")"
      pendingFromTarget="$(realpath -ms --relative-to="$targetParent" "$livePending")"

      # shellcheck disable=SC2329
      cleanupLiveTransition() {
        result="$?"
        set +e
        if [[ ! -L "$legacy" && -d "$legacy" ]]; then
          [[ -L "$target" ]] && rm -f "$target"
          [[ -L "$livePending" ]] && rm -f "$livePending"
        fi
        exit "$result"
      }
      trap cleanupLiveTransition EXIT

      # Before the first exchange only the legacy path is live. Between the
      # two exchanges both legacy and target resolve through livePending to
      # the original directory. After the second exchange the original inode
      # is the target and legacy is its compatibility redirect.
      ln -s "$redirectTarget" "$livePending"
      ln -s "$pendingFromTarget" "$target"
      exchange-paths "$legacy" "$livePending" "$target"
      rm -f "$livePending"

      if [[ ! -L "$legacy" || ! -d "$target" || -L "$target" ]]; then
        echo "Codex home migration failed to publish the live directory" >&2
        exit 1
      fi
      if [[ "$(realpath "$legacy")" != "$(realpath "$target")" ]]; then
        echo "Codex home migration produced an invalid legacy redirect" >&2
        exit 1
      fi
      if [[ "$("$statCommand" -c %d:%i -- "$target")" != "$legacyIdentity" ]]; then
        echo "Codex home migration changed the live directory identity" >&2
        exit 1
      fi
      trap - EXIT
      printf 'Moved live Codex home to %s without copying; redirected %s to the same directory\n' \
        "$target" "$legacy"
      exit 0
    fi

    stageParent="''${CODEX_HOME_MIGRATION_STAGE_PARENT:-''${TMPDIR:-/tmp}}"
    if [[ -L "$stageParent" || ! -d "$stageParent" ]]; then
      echo "Codex home migration requires a real staging directory: $stageParent" >&2
      exit 1
    fi
    stageParent="$(realpath "$stageParent")"
    stageParentOwner="$("$statCommand" -c %u "$stageParent")"
    stageParentMode="$("$statCommand" -c %a "$stageParent")"
    if [[ "$stageParentOwner" != "$currentOwner" && "$stageParentOwner" != 0 ]]; then
      echo "Codex home migration refuses a staging directory owned by another user: $stageParent" >&2
      exit 1
    fi
    if (( (8#$stageParentMode & 0022) && !(8#$stageParentMode & 01000) )); then
      echo "Codex home migration refuses a writable non-sticky staging directory: $stageParent" >&2
      exit 1
    fi
    if [[ "$("$statCommand" -c %d "$stageParent")" != "$("$statCommand" -c %d "$targetParent")" ]]; then
      echo "Codex home migration requires its private staging directory and target on one filesystem: $stageParent, $targetParent" >&2
      exit 1
    fi

    stage=""
    stageIdentity=""
    pending="$targetParent/.codex-home-migration.pending-$$"
    legacyIdentity="$("$statCommand" -c %d:%i -- "$legacy")"
    redirectTarget="$(realpath -m --relative-to="$(dirname "$legacy")" "$target")"
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup="$legacy.backup-$timestamp"

    if [[ -e "$backup" || -L "$backup" ]]; then
      echo "Codex home migration backup already exists: $backup" >&2
      exit 1
    fi
    if [[ -e "$pending" || -L "$pending" ]]; then
      echo "Codex home migration pending marker already exists: $pending" >&2
      exit 1
    fi

    isPublishedTarget() {
      local targetIdentity
      [[ -n "$stageIdentity" && ! -L "$target" && -d "$target" ]] || return 1
      targetIdentity="$("$statCommand" -c %d:%i -- "$target")" || return 1
      [[ "$targetIdentity" == "$stageIdentity" ]]
    }

    hasOriginalIdentity() {
      local path="$1"
      local identity
      [[ ! -L "$path" && -d "$path" ]] || return 1
      identity="$("$statCommand" -c %d:%i -- "$path")" || return 1
      [[ "$identity" == "$legacyIdentity" ]]
    }

    isManagedRedirect() {
      local path="$1"
      [[ -L "$path" && "$(realpath "$path")" == "$(realpath "$target")" ]]
    }

    migrationComplete() {
      isPublishedTarget && isManagedRedirect "$legacy" && hasOriginalIdentity "$backup"
    }

    isPreparedRedirect() {
      local path="$1"
      [[ -L "$path" && "$(readlink "$path")" == "$redirectTarget" ]]
    }

    removeDirectory() {
      local directory="$1"
      [[ -d "$directory" && ! -L "$directory" ]] || return 0
      ${pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
        ${pkgs.darwin.file_cmds}/bin/chmod -f -RN "$directory" || true
      ''}
      chmod -R u+rwX "$directory" || true
      rm -rf "$directory"
    }

    rollback() {
      result="$?"
      set +e
      if migrationComplete; then
        exit "$result"
      fi
      if ! hasOriginalIdentity "$legacy"; then
        echo "Unable to prove that the original Codex home was restored; preserving every migration artifact" >&2
        exit "$result"
      fi
      if isPublishedTarget; then
        echo "Published Codex target may contain concurrent writes; preserving it for recovery: $target" >&2
      else
        if isPreparedRedirect "$backup"; then
          rm -f "$backup"
        fi
        rm -f "$pending"
      fi
      removeDirectory "$stage"
      exit "$result"
    }
    trap rollback EXIT

    if ! stage="$(mktemp -d "$stageParent/.codex-home-migration.XXXXXXXX")"; then
      echo "Unable to create a private Codex migration stage" >&2
      exit 1
    fi
    chmod 700 "$stage"
    stageIdentity="$("$statCommand" -c %d:%i -- "$stage")"

    # The lock file is linked into the staged home after copying. Both the old
    # and new Codex paths then name one flock inode throughout atomic cutover.
    copyRsyncArgs=("''${rsyncArgs[@]}" --exclude=/.tmp/plugins.sync.lock)
    rsync "''${copyRsyncArgs[@]}" "$legacy/" "$stage/"
    mkdir -p "$stage/.tmp"
    ln "$lockPath" "$stage/.tmp/plugins.sync.lock"
    touch -r "$legacy/.tmp" "$stage/.tmp"
    differences="$(rsync "''${copyRsyncArgs[@]}" -nic --delete "$legacy/" "$stage/")"
    if [[ -n "$differences" ]]; then
      printf '%s\n' "$differences" >&2
      echo "Staged Codex home failed content or metadata verification" >&2
      exit 1
    fi
    if [[ "$("$statCommand" -c %d:%i -- "$lockPath")" != "$("$statCommand" -c %d:%i -- "$stage/.tmp/plugins.sync.lock")" ]]; then
      echo "Staged Codex home does not share the startup-sync lock inode" >&2
      exit 1
    fi

    printf '%s\n' "$backup" > "$pending"
    ln -s "$redirectTarget" "$backup"
    rename-no-replace "$stage" "$target"
    exchange-paths "$legacy" "$backup"

    # The exchange freezes the original tree at its final backup path. A
    # writer that bypassed startup-sync locking after the first lsof scan must
    # never turn a stale stage into a successful migration. Repository tools
    # may legitimately recognize and update Git metadata once the private
    # stage is published, so compare every non-Git path while retaining the
    # complete pre-publication Git data in the rollback directory.
    assertUnusedExceptStartupLock "$backup"
    assertUnusedExceptStartupLock "$target"
    postCutoverRsyncArgs=("''${copyRsyncArgs[@]}" --exclude=.git/)
    differences="$(rsync "''${postCutoverRsyncArgs[@]}" -nic --delete "$backup/" "$target/")"
    if [[ -n "$differences" ]]; then
      printf '%s\n' "$differences" >&2
      echo "Codex home changed during atomic cutover; preserving target and backup for recovery" >&2
      exit 1
    fi
    rm -f "$pending"
    trap - EXIT

    printf 'Migrated Codex home to %s; redirected %s and preserved rollback copy at %s\n' \
      "$target" "$legacy" "$backup"
  '';
}
