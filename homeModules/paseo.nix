{ self }:

{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.paseo;
  jsonFormat = pkgs.formats.json { };
  paseoHome = "${config.home.homeDirectory}/.paseo";
  providerPath = lib.concatStringsSep ":" (
    lib.optional (cfg.extraPackages != [ ]) (lib.makeBinPath cfg.extraPackages)
    ++ [
      "${config.home.homeDirectory}/.nix-profile/bin"
      "${config.home.homeDirectory}/.local/bin"
      "${config.home.homeDirectory}/.local/state/nix/profile/bin"
      "/etc/profiles/per-user/${config.home.username}/bin"
      "/run/current-system/sw/bin"
      "/nix/var/nix/profiles/default/bin"
    ]
    ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [ "/run/wrappers/bin" ]
    ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [ "/opt/homebrew/bin" ]
    ++ [
      "/usr/local/bin"
      "/usr/bin"
      "/bin"
      "/usr/sbin"
      "/sbin"
    ]
  );
  serviceEnvironment = {
    NODE_ENV = "production";
    PASEO_HOME = paseoHome;
    PASEO_LISTEN = "${cfg.listenAddress}:${toString cfg.port}";
    PATH = providerPath;
  }
  // cfg.environment;
  configSource =
    if builtins.isAttrs cfg.config then
      jsonFormat.generate "paseo-config.json" cfg.config
    else
      cfg.config;
  serverArguments = [
    "${cfg.package}/bin/paseo-server"
  ]
  ++ lib.optional (!cfg.relay.enable) "--no-relay";
in
{
  options.services.paseo = {
    enable = lib.mkEnableOption "Paseo headless daemon";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.paseo;
      defaultText = lib.literalExpression "inputs.coolheaded.packages.\${pkgs.stdenv.hostPlatform.system}.paseo";
      description = "Paseo package providing the CLI and headless daemon.";
    };

    config = lib.mkOption {
      type = lib.types.nullOr (lib.types.either (lib.types.attrsOf jsonFormat.type) lib.types.path);
      default = null;
      description = ''
        Paseo configuration expressed as a Nix attribute set or as the path to
        a complete JSON configuration file. The result is written to
        {file}`~/.paseo/config.json`. Keep plaintext secrets outside Nix-managed
        configuration because generated values are stored in the Nix store.
      '';
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = ''
        Additional environment variables for the Paseo daemon. Values are
        stored in the Nix store, so do not put plaintext secrets here.
      '';
    };

    extraPackages = lib.mkOption {
      type = lib.types.listOf lib.types.package;
      default = [ ];
      description = ''
        Additional provider CLIs and tools to prepend to the daemon's PATH.
        User profile paths are included automatically.
      '';
    };

    listenAddress = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address for the Paseo daemon to bind to.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 6767;
      description = "Port for the Paseo daemon to listen on.";
    };

    relay.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether to enable relay-based remote access.";
    };
  };

  config = lib.mkIf cfg.enable (
    lib.mkMerge [
      {
        home = {
          packages = [ cfg.package ];

          file.".paseo/config.json" = lib.mkIf (cfg.config != null) {
            source = configSource;
            onChange = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin ''
              domain="${config.launchd.agents.paseo.domain}/$(id -u)"
              /bin/launchctl kickstart -k "$domain/org.nix-community.home.paseo" \
                2>/dev/null || true
            '';
          };
        };
      }

      (lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
        systemd.user.services.paseo = {
          Unit = {
            Description = "Paseo headless daemon";
            X-Restart-Triggers = lib.optional (cfg.config != null) configSource;
          };

          Service = {
            Environment = lib.mapAttrsToList (name: value: "${name}=${value}") serviceEnvironment;
            ExecStart = lib.escapeShellArgs serverArguments;
            KillSignal = "SIGTERM";
            Restart = "on-failure";
            RestartSec = 5;
            TimeoutStopSec = 15;
          };

          Install.WantedBy = [ "default.target" ];
        };
      })

      (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
        launchd.agents.paseo = {
          enable = true;
          domain = lib.mkDefault "user";
          config = {
            EnvironmentVariables = serviceEnvironment;
            KeepAlive.SuccessfulExit = false;
            ProcessType = "Background";
            ProgramArguments = serverArguments;
            RunAtLoad = true;
            ThrottleInterval = 5;
          };
        };
      })
    ]
  );
}
