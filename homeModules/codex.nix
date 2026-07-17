{ self }:

moduleArgs@{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.codex;
  modulesPath = moduleArgs.modulesPath or null;

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

  renderKeyPath = path: lib.concatStringsSep "." (map builtins.toJSON path);
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

  managedEdits = lib.concatMap (name: flattenValue [ name ] cfg.settings.${name}) (
    lib.sort builtins.lessThan (builtins.attrNames cfg.settings)
  );
  managedEditsFile = pkgs.writeText "codex-managed-edits.json" (builtins.toJSON managedEdits);

  configDirectory =
    if config.home.preferXdgDirectories then
      "${config.xdg.configHome}/codex"
    else
      "${config.home.homeDirectory}/.codex";
  configFile = "${configDirectory}/config.toml";

  reconcileConfig = pkgs.writeShellApplication {
    name = "codex-config-reconcile";
    runtimeInputs = [
      cfg.package
      pkgs.coreutils
      pkgs.jq
      pkgs.toml-sort
    ];
    text = ''
      target="$1"
      desired_edits_file="$2"

      umask 077
      jq -e '
        type == "array"
        and all(.[];
          type == "object"
          and (.keyPath | type == "string")
          and .mergeStrategy == "replace"
          and has("value")
        )
      ' "$desired_edits_file" >/dev/null

      target_directory="$(dirname "$target")"
      mkdir -p "$target_directory"

      validate_target() {
        if [[ -L "$target" ]]; then
          echo "Codex config must be a writable regular file, but $target is a symbolic link" >&2
          return 1
        fi
        if [[ -e "$target" && ! -f "$target" ]]; then
          echo "Codex config must be a writable regular file: $target" >&2
          return 1
        fi
        if [[ -e "$target" && ! -w "$target" ]]; then
          echo "Codex config is not writable: $target" >&2
          return 1
        fi
      }
      validate_target

      if [[ ! -e "$target" ]] && jq -e 'length == 0' "$desired_edits_file" >/dev/null; then
        exit 0
      fi

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
        rm -rf "''${runtime_root:?}"
      }
      trap cleanup EXIT

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

      apply_edits() {
        local candidate="$1"
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
          version="sha256:$(sha256sum "$candidate" | cut -d ' ' -f 1)"
        fi

        if jq -e 'length == 0' "$desired_edits_file" >/dev/null; then
          stop_server
          return 0
        fi

        jq -nc \
          --slurpfile edits "$desired_edits_file" \
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
        stop_server
      }

      success=""
      for attempt in 1 2 3; do
        : "$attempt"
        rm -rf "''${runtime_root:?}/home" "''${runtime_root:?}/codex-home"
        mkdir -p "$runtime_root/home" "$runtime_root/codex-home"

        validate_target
        candidate="$runtime_root/codex-home/config.toml"
        snapshot_exists=""
        snapshot_hash=""
        if [[ -e "$target" ]]; then
          snapshot_exists=1
          snapshot_hash="$(sha256sum "$target" | cut -d ' ' -f 1)"
          cp --preserve=mode -- "$target" "$candidate"
        elif jq -e 'length == 0' "$desired_edits_file" >/dev/null; then
          success=1
          break
        else
          install -m 600 /dev/null "$candidate"
        fi

        apply_edits "$candidate"

        sorted_file="$(mktemp "$target_directory/.config.toml.home-manager.XXXXXX")"
        toml-sort \
          --sort-inline-tables \
          --sort-table-keys \
          --output "$sorted_file" \
          "$candidate"
        toml-sort \
          --check \
          --sort-inline-tables \
          --sort-table-keys \
          "$sorted_file"

        if [[ -n "$snapshot_exists" ]]; then
          validate_target
          if [[ ! -e "$target" ]] || [[ "$(sha256sum "$target" | cut -d ' ' -f 1)" != "$snapshot_hash" ]]; then
            rm -f "$sorted_file"
            sorted_file=""
            continue
          fi
          if cmp -s "$target" "$sorted_file"; then
            rm -f "$sorted_file"
          else
            chmod --reference="$target" "$sorted_file"
            mv -f "$sorted_file" "$target"
          fi
        else
          if [[ -e "$target" || -L "$target" ]]; then
            rm -f "$sorted_file"
            sorted_file=""
            continue
          fi
          chmod 600 "$sorted_file"
          mv -f "$sorted_file" "$target"
        fi
        sorted_file=""
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
  key = "coolheaded.homeModules.codex";

  disabledModules = lib.optional (modulesPath != null) "${modulesPath}/programs/codex";

  options.programs.codex = {
    enable = lib.mkEnableOption "OpenAI Codex";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.codex;
      defaultText = lib.literalExpression "inputs.coolheaded.packages.\${pkgs.stdenv.hostPlatform.system}.codex";
      description = "Codex package to install and use for configuration reconciliation.";
    };

    settings = lib.mkOption {
      type = lib.types.attrsOf configValueType;
      default = { };
      description = ''
        Partial Codex settings owned by Home Manager. Activation writes only
        declared values through Codex app-server, preserves every undeclared
        value, and canonically sorts the complete writable
        {file}config.toml. A null value deletes that exact node; removing a
        declaration leaves its current value untouched. Do not put secrets
        here because Nix stores option values in the world-readable store.
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
  };

  config = lib.mkIf cfg.enable {
    home = {
      packages = [ cfg.package ];
      sessionVariables = lib.optionalAttrs config.home.preferXdgDirectories {
        CODEX_HOME = configDirectory;
      };

      activation.codexConfig = {
        after = [ "linkGeneration" ];
        before = [ ];
        data = ''
          run ${reconcileConfig}/bin/codex-config-reconcile \
            ${lib.escapeShellArg configFile} \
            ${managedEditsFile}
        '';
      };
    };
  };
}
