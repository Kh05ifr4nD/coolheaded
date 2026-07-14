{ self }:

{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.lazyCodexAi;
  statePackage = "state/lazycodex-ai-package";
  codexHome =
    if config.home.preferXdgDirectories then
      "${config.xdg.configHome}/codex"
    else
      "${config.home.homeDirectory}/.codex";
  installArguments = [
    "${cfg.package}/bin/lazycodex-ai"
    "install"
    "--no-tui"
  ]
  ++ lib.optional (cfg.codexAutonomous == true) "--codex-autonomous"
  ++ lib.optional (cfg.codexAutonomous == false) "--no-codex-autonomous";
  codeGraphPath = [
    "plugins"
    "omo@sisyphuslabs"
    "mcp_servers"
    "codegraph"
    "enabled"
  ];
  withIsolatedProject = command: ''
    (
      lazyCodexAiProject="$(mktemp -d "''${TMPDIR:-/tmp}/lazycodex-ai-project.XXXXXX")"
      trap 'rm -rf "$lazyCodexAiProject"' EXIT
      ${command}
    )
  '';
in
{
  imports = [ (import ./codex.nix { inherit self; }) ];

  options.programs.lazyCodexAi = {
    enable = lib.mkEnableOption "LazyCodex AI";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.lazyCodexAi;
      defaultText = lib.literalExpression "inputs.coolheaded.packages.\${pkgs.stdenv.hostPlatform.system}.lazyCodexAi";
      description = "LazyCodex AI package to install and use for lifecycle operations.";
    };

    cleanupOnDisable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Run the package version recorded by the previous Home Manager
        generation to remove LazyCodex-managed plugin state when this module
        transitions from enabled to disabled. Imperative installations that
        were never enabled through this module are left untouched.
      '';
    };

    codexAutonomous = lib.mkOption {
      type = lib.types.nullOr lib.types.bool;
      default = null;
      description = ''
        Whether the installer writes its autonomous Codex permission defaults.
        Null omits both CLI flags and follows the packaged LazyCodex behavior;
        true passes --codex-autonomous; false passes --no-codex-autonomous.
        Values declared through programs.codex.config are reconciled after
        installation and therefore remain authoritative.
      '';
    };

    codeGraph = lib.mkOption {
      type = lib.types.nullOr lib.types.bool;
      default = null;
      description = ''
        Whether the OMO CodeGraph MCP server is enabled. Null leaves the leaf
        unmanaged and follows the packaged LazyCodex behavior. True or false
        declares the leaf through programs.codex.config. A direct user value
        in programs.codex.config has higher priority.
      '';
    };
  };

  config = lib.mkMerge [
    {
      home.activation.lazyCodexAi = {
        after = [ "codexHomeMigration" ];
        before = [ "codexConfig" ];
        data =
          if cfg.enable then
            withIsolatedProject ''
              run env \
                CODEX_HOME=${lib.escapeShellArg codexHome} \
                OMO_CODEX_PROJECT="$lazyCodexAiProject" \
                OMO_CODEX_DISABLE_POSTHOG=1 \
                ${lib.escapeShellArgs installArguments}
            ''
          else
            lib.optionalString cfg.cleanupOnDisable (withIsolatedProject ''
              previousGeneration="''${oldGenPath:-}"
              previousPackage="$previousGeneration/${statePackage}"
              if [[ -n "$previousGeneration" && -x "$previousPackage/bin/lazycodex-ai" ]]; then
                run env \
                  CODEX_HOME=${lib.escapeShellArg codexHome} \
                  OMO_CODEX_PROJECT="$lazyCodexAiProject" \
                  OMO_CODEX_DISABLE_POSTHOG=1 \
                  "$previousPackage/bin/lazycodex-ai" uninstall --json
              fi
            '');
      };
    }

    (lib.mkIf cfg.enable {
      assertions = [
        {
          assertion = config.programs.codex.enable;
          message = "`programs.lazyCodexAi.enable` requires `programs.codex.enable`";
        }
      ];

      programs.codex = {
        enable = lib.mkDefault true;
        config = lib.mkIf (cfg.codeGraph != null) {
          plugins."omo@sisyphuslabs".mcp_servers.codegraph.enabled = lib.mkDefault cfg.codeGraph;
        };
        releasedConfigPaths = lib.optional (cfg.codeGraph == null) codeGraphPath;
      };

      home = {
        packages = [ cfg.package ];
        extraBuilderCommands = lib.mkAfter ''
          mkdir -p "$out/state"
          ln -s ${cfg.package} "$out/${statePackage}"
        '';
      };
    })
  ];
}
