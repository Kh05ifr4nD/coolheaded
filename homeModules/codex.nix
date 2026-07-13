{ self }:

{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.codex;

  configValueType = lib.types.nullOr (
    lib.types.oneOf [
      lib.types.bool
      lib.types.int
      lib.types.float
      lib.types.str
      lib.types.path
      (lib.types.listOf configValueType)
      (lib.types.attrsOf configValueType)
    ]
  );

  quoteKey = builtins.toJSON;
  renderKeyPath = path: lib.concatStringsSep "." (map quoteKey path);

  flattenValue =
    path: value:
    if builtins.isAttrs value && value != { } then
      lib.concatMap (name: flattenValue (path ++ [ name ]) value.${name}) (
        lib.sort builtins.lessThan (builtins.attrNames value)
      )
    else
      [
        {
          keyPath = renderKeyPath path;
          mergeStrategy = "replace";
          inherit value;
        }
      ];

  managedEdits = lib.concatMap (name: flattenValue [ name ] cfg.config.${name}) (
    lib.sort builtins.lessThan (builtins.attrNames cfg.config)
  );
  managedPaths = map (edit: edit.keyPath) managedEdits;

  managedEditsFile = pkgs.writeText "codex-managed-edits.json" (builtins.toJSON managedEdits);
  managedPathsFile = pkgs.writeText "codex-managed-paths.json" (builtins.toJSON managedPaths);
  stateFile = "state/codex-managed-paths.json";

  configDirectory = "${config.home.homeDirectory}/.codex";
  configFile = "${configDirectory}/config.toml";

  reconcileConfig = pkgs.writeShellApplication {
    name = "codex-config-reconcile";
    runtimeInputs = lib.optional (cfg.package != null) cfg.package ++ [
      pkgs.coreutils
      pkgs.jq
      pkgs.toml-sort
    ];
    text = ''
      target="$1"
      desired_edits_file="$2"
      current_paths_file="$3"
      old_paths_file="''${4:-}"

      umask 077
      target_directory="$(dirname "$target")"
      mkdir -p "$target_directory"

      if [[ -L "$target" ]]; then
        echo "Codex config must be a writable regular file, but $target is a symbolic link" >&2
        exit 1
      fi
      if [[ -e "$target" && ! -f "$target" ]]; then
        echo "Codex config must be a writable regular file: $target" >&2
        exit 1
      fi
      if [[ ! -e "$target" ]]; then
        install -m 600 /dev/null "$target"
      fi
      chmod 600 "$target"

      runtime_root="$(mktemp -d "''${TMPDIR:-/tmp}/codex-home-manager.XXXXXX")"
      sorted_file=""
      server_pid=""
      server_read_fd=""
      server_write_fd=""

      cleanup() {
        set +e
        if [[ -n "$server_write_fd" ]]; then
          exec {server_write_fd}>&-
        fi
        if [[ -n "$server_read_fd" ]]; then
          exec {server_read_fd}<&-
        fi
        if [[ -n "$server_pid" ]]; then
          kill "$server_pid" 2>/dev/null
          wait "$server_pid" 2>/dev/null
        fi
        if [[ -n "$sorted_file" ]]; then
          rm -f "$sorted_file"
        fi
        rm -rf "$runtime_root"
      }
      trap cleanup EXIT

      mkdir -p "$runtime_root/home" "$runtime_root/codex-home"
      ln -s "$target" "$runtime_root/codex-home/config.toml"

      if [[ -n "$old_paths_file" && -f "$old_paths_file" ]]; then
        cp "$old_paths_file" "$runtime_root/old-paths.json"
      else
        printf '[]\n' >"$runtime_root/old-paths.json"
      fi

      jq -e 'type == "array"' "$desired_edits_file" >/dev/null
      jq -e 'type == "array" and all(.[]; type == "string")' "$current_paths_file" >/dev/null
      jq -e 'type == "array" and all(.[]; type == "string")' "$runtime_root/old-paths.json" >/dev/null

      jq -n \
        --slurpfile desired "$desired_edits_file" \
        --slurpfile current "$current_paths_file" \
        --slurpfile old "$runtime_root/old-paths.json" \
        '($current[0] | unique) as $currentPaths
        | (($old[0] | unique) - $currentPaths) as $stalePaths
        | ($desired[0] + ($stalePaths | map({
            keyPath: ., mergeStrategy: "replace", value: null
          })))
        | sort_by(.keyPath)' \
        >"$runtime_root/edits.json"

      read_response() {
        local request_id="$1"
        local line

        while IFS= read -r -u "$server_read_fd" line; do
          if jq -e --argjson request_id "$request_id" '.id == $request_id' <<<"$line" >/dev/null 2>&1; then
            printf '%s\n' "$line"
            return 0
          fi
        done

        echo "Codex app-server exited before replying to request $request_id" >&2
        if [[ -s "$runtime_root/app-server.stderr" ]]; then
          cat "$runtime_root/app-server.stderr" >&2
        fi
        return 1
      }

      stop_server() {
        exec {server_write_fd}>&-
        server_write_fd=""
        while IFS= read -r -u "$server_read_fd"; do :; done
        exec {server_read_fd}<&-
        server_read_fd=""
        if ! wait "$server_pid"; then
          cat "$runtime_root/app-server.stderr" >&2
          return 1
        fi
        server_pid=""
      }

      applied_hash=""
      apply_edits() {
        local response
        local status
        local version

        : >"$runtime_root/app-server.stderr"
        coproc CODEX_SERVER {
          env \
            HOME="$runtime_root/home" \
            CODEX_HOME="$runtime_root/codex-home" \
            codex app-server --disable plugins --listen stdio:// \
            2>"$runtime_root/app-server.stderr"
        }
        server_pid="$CODEX_SERVER_PID"
        server_read_fd="''${CODEX_SERVER[0]}"
        server_write_fd="''${CODEX_SERVER[1]}"

        jq -nc '{
          id: 1,
          method: "initialize",
          params: {
            capabilities: { experimentalApi: true },
            clientInfo: {
              name: "home-manager",
              title: "Home Manager",
              version: "1"
            }
          }
        }' >&"$server_write_fd"
        response="$(read_response 1)"
        if ! jq -e '.error == null' <<<"$response" >/dev/null; then
          jq -r '.error.message // "Codex app-server initialization failed"' <<<"$response" >&2
          return 1
        fi

        jq -nc '{ method: "initialized", params: {} }' >&"$server_write_fd"
        jq -nc '{ id: 2, method: "config/read", params: { includeLayers: true } }' >&"$server_write_fd"
        response="$(read_response 2)"
        if ! jq -e '.error == null' <<<"$response" >/dev/null; then
          jq -r '.error.message // "Codex config read failed"' <<<"$response" >&2
          return 1
        fi

        version="$(
          jq -r '
            first(
              .result.layers[]
              | select(.name.type == "user" and .name.profile == null)
              | .version
            ) // empty
          ' <<<"$response"
        )"
        if [[ -z "$version" ]]; then
          version="sha256:$(sha256sum "$target" | cut -d ' ' -f 1)"
        fi

        if jq -e 'length == 0' "$runtime_root/edits.json" >/dev/null; then
          applied_hash="$(sha256sum "$target" | cut -d ' ' -f 1)"
          stop_server
          return 0
        fi

        jq -nc \
          --slurpfile edits "$runtime_root/edits.json" \
          --arg version "$version" \
          '{
            id: 3,
            method: "config/batchWrite",
            params: {
              edits: $edits[0],
              expectedVersion: $version
            }
          }' >&"$server_write_fd"
        response="$(read_response 3)"
        if ! jq -e '.error == null' <<<"$response" >/dev/null; then
          if jq -e '(.error.message // "") | test("version|conflict"; "i")' <<<"$response" >/dev/null; then
            stop_server || true
            return 75
          fi
          jq -r '.error.message // "Codex config write failed"' <<<"$response" >&2
          return 1
        fi

        status="$(jq -er '.result.status' <<<"$response")"
        case "$status" in
          ok | okOverridden) ;;
          *)
            echo "Codex config write returned unexpected status: $status" >&2
            return 1
            ;;
        esac
        jq -er '.result.version' <<<"$response" >/dev/null
        applied_hash="$(sha256sum "$target" | cut -d ' ' -f 1)"
        stop_server
      }

      success=""
      for attempt in 1 2 3; do
        : "$attempt"
        if apply_edits; then
          :
        else
          result="$?"
          if [[ "$result" == 75 ]]; then
            continue
          fi
          exit "$result"
        fi

        sorted_file="$(mktemp "$target_directory/.config.toml.home-manager.XXXXXX")"
        toml-sort \
          --sort-inline-tables \
          --sort-table-keys \
          --output "$sorted_file" \
          "$target"
        toml-sort \
          --check \
          --sort-inline-tables \
          --sort-table-keys \
          "$sorted_file"

        current_hash="$(sha256sum "$target" | cut -d ' ' -f 1)"
        if [[ "$current_hash" != "$applied_hash" ]]; then
          rm -f "$sorted_file"
          sorted_file=""
          continue
        fi

        if cmp -s "$target" "$sorted_file"; then
          rm -f "$sorted_file"
          sorted_file=""
        else
          chmod 600 "$sorted_file"
          mv -f "$sorted_file" "$target"
          sorted_file=""
        fi
        chmod 600 "$target"
        success=1
        break
      done

      if [[ -z "$success" ]]; then
        echo "Codex config changed concurrently during three reconciliation attempts: $target" >&2
        exit 1
      fi
    '';
  };
in
{
  options.programs.codex.config = lib.mkOption {
    type = lib.types.attrsOf configValueType;
    default = { };
    description = ''
      Partial Codex configuration owned by Home Manager. Activation writes the
      declared leaf values through Codex app-server, deletes formerly managed
      leaves that are no longer declared, preserves all other app-owned values,
      and canonically sorts the complete writable {file}`config.toml`. A null
      value deletes that exact leaf. The module keeps {env}`CODEX_HOME` at
      {file}`~/.codex` so the CLI and Codex App share one writable state root.
      Do not put secrets here because Nix stores option values in the
      world-readable store.
    '';
    example = lib.literalExpression ''
      {
        model = "gpt-5.5";
        model_reasoning_effort = "xhigh";
        features.plugins = true;
        plugins."example@home-manager".enabled = true;
      }
    '';
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.package != null;
        message = "`programs.codex.config` requires a non-null `programs.codex.package`";
      }
      {
        assertion = cfg.settings == { };
        message = "Declare Codex settings in `programs.codex.config`, not `programs.codex.settings`";
      }
      {
        assertion = !cfg.enableMcpIntegration;
        message = "Declare MCP servers in `programs.codex.config`, not `programs.codex.enableMcpIntegration`";
      }
      {
        assertion = cfg.plugins == [ ] && cfg.marketplaces == { };
        message = "Declare plugins and marketplaces in `programs.codex.config`";
      }
    ];

    programs.codex.package = lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.codex;

    home.sessionVariables.CODEX_HOME = lib.mkForce configDirectory;

    home.extraBuilderCommands = lib.mkAfter ''
      mkdir -p "$out/state"
      ln -s ${managedPathsFile} "$out/${stateFile}"
    '';

    home.activation.codexConfig = {
      after = [ "linkGeneration" ];
      before = [ ];
      data = ''
        oldManagedPaths=""
        previousGeneration="''${oldGenPath:-}"
        if [[ -n "$previousGeneration" && -f "$previousGeneration/${stateFile}" ]]; then
          oldManagedPaths="$previousGeneration/${stateFile}"
        fi
        run ${reconcileConfig}/bin/codex-config-reconcile \
          ${lib.escapeShellArg configFile} \
          ${managedEditsFile} \
          ${managedPathsFile} \
          "$oldManagedPaths"
      '';
    };
  };
}
