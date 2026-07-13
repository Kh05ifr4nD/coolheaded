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
  settingsFile = jsonFormat.generate "paseo-config.json" cfg.settings;
  reservedEnvironmentVariables = [
    "NODE_ENV"
    "PASEO_HOME"
    "PASEO_HOSTNAMES"
    "PASEO_LISTEN"
    "PASEO_RELAY_ENDPOINT"
    "PASEO_RELAY_PUBLIC_USE_TLS"
    "PASEO_RELAY_USE_TLS"
    "PATH"
  ];
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
    PASEO_HOME = cfg.dataDir;
    PASEO_LISTEN = "${cfg.listenAddress}:${toString cfg.port}";
    PATH = providerPath;
  }
  // lib.optionalAttrs (cfg.hostnames == true) { PASEO_HOSTNAMES = "true"; }
  // lib.optionalAttrs (lib.isList cfg.hostnames && cfg.hostnames != [ ]) {
    PASEO_HOSTNAMES = lib.concatStringsSep "," cfg.hostnames;
  }
  // lib.optionalAttrs (cfg.relay.enable && cfg.relay.mode == "remote") {
    PASEO_RELAY_ENDPOINT = "${cfg.relay.host}:${toString cfg.relay.port}";
    PASEO_RELAY_USE_TLS = if cfg.relay.useTls then "true" else "false";
  }
  // lib.optionalAttrs (
    cfg.relay.enable && cfg.relay.mode == "remote" && cfg.relay.publicUseTls != null
  ) { PASEO_RELAY_PUBLIC_USE_TLS = if cfg.relay.publicUseTls then "true" else "false"; }
  // cfg.environment;
  serverArguments = [
    "${cfg.package}/bin/paseo-server"
  ]
  ++ lib.optional (!cfg.relay.enable) "--no-relay";
  startScript = pkgs.writeShellApplication {
    name = "paseo-start";
    runtimeInputs = [ pkgs.coreutils ];
    text = ''
      install -d -m 0700 ${lib.escapeShellArg cfg.dataDir}
      ${lib.optionalString (cfg.settings != { }) ''
        install -m 0600 ${settingsFile} ${lib.escapeShellArg "${cfg.dataDir}/config.json"}
      ''}
      exec ${lib.escapeShellArgs serverArguments}
    '';
  };
  startCommand = "${startScript}/bin/paseo-start";
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

    dataDir = lib.mkOption {
      type = lib.types.str;
      default = "${config.home.homeDirectory}/.paseo";
      defaultText = lib.literalExpression ''"\${config.home.homeDirectory}/.paseo"'';
      description = "Directory for Paseo state, configuration, and logs (PASEO_HOME).";
    };

    settings = lib.mkOption {
      type = jsonFormat.type;
      default = { };
      description = ''
        Declarative content for {file}`$PASEO_HOME/config.json`. The daemon
        receives a writable regular file copied from these settings before
        every service start.

        Runtime mutations made by the CLI or app are overwritten on the next
        restart. Manage the file through this option or through Paseo, not
        both. Leave this option empty to let Paseo own the file completely.
        Do not put secrets here because Nix stores option values in the
        world-readable store.
      '';
      example = lib.literalExpression ''
        {
          daemon.mcp = {
            enabled = true;
            injectIntoAgents = false;
          };
        }
      '';
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = ''
        Additional environment variables for the Paseo daemon. Values are
        stored in the Nix store, so do not put plaintext secrets here. Variables
        controlled by dedicated module options cannot be overridden here.
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

    hostnames = lib.mkOption {
      type = lib.types.either (lib.types.enum [ true ]) (lib.types.listOf lib.types.str);
      default = [ ];
      example = [
        ".example.com"
        "paseo.internal"
      ];
      description = ''
        Hostnames accepted by Paseo's DNS-rebinding protection. Localhost and
        IP addresses are accepted automatically. A leading dot matches a
        domain and its subdomains; true accepts any hostname.
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

    relay = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Whether to enable relay-based remote access. When false, Paseo runs
          with --no-relay and accepts only direct connections.
        '';
      };

      mode = lib.mkOption {
        type = lib.types.enum [
          "hosted"
          "remote"
        ];
        default = "hosted";
        description = ''
          Relay deployment mode: hosted uses the upstream relay; remote
          connects to a separately deployed relay.
        '';
      };

      host = lib.mkOption {
        type = lib.types.str;
        default = "";
        example = "relay.example.com";
        description = "Relay hostname, required when relay.mode is remote.";
      };

      port = lib.mkOption {
        type = lib.types.port;
        default = 443;
        description = "Relay port used when relay.mode is remote.";
      };

      useTls = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether the daemon-to-relay connection uses TLS.";
      };

      publicUseTls = lib.mkOption {
        type = lib.types.nullOr lib.types.bool;
        default = null;
        description = ''
          Whether the public relay endpoint uses TLS. Null inherits useTls;
          override it for a plain internal connection behind TLS termination.
        '';
      };
    };
  };

  config = lib.mkIf cfg.enable (
    lib.mkMerge [
      {
        assertions = [
          {
            assertion = !(cfg.relay.enable && cfg.relay.mode == "remote" && cfg.relay.host == "");
            message = "`services.paseo.relay.host` is required when relay mode is remote";
          }
          {
            assertion =
              lib.intersectLists reservedEnvironmentVariables (builtins.attrNames cfg.environment) == [ ];
            message = "`services.paseo.environment` cannot override variables controlled by dedicated Paseo module options";
          }
        ];

        home.packages = [ cfg.package ];
      }

      (lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
        systemd.user.services.paseo = {
          Unit = {
            Description = "Paseo headless daemon";
            X-Restart-Triggers = lib.optional (cfg.settings != { }) settingsFile;
          };

          Service = {
            Environment = lib.mapAttrsToList (name: value: "${name}=${value}") serviceEnvironment;
            ExecStart = lib.escapeShellArgs [ startCommand ];
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
            ProgramArguments = [ startCommand ];
            RunAtLoad = true;
            ThrottleInterval = 5;
          };
        };
      })
    ]
  );
}
