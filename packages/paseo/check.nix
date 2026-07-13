{
  lib,
  package,
  pkgs,
  ...
}:

let
  system = pkgs.stdenv.hostPlatform.system;
  homeDirectory =
    if pkgs.stdenv.hostPlatform.isDarwin then "/Users/paseo-test" else "/home/paseo-test";
  paseoHome = "${homeDirectory}/.paseo";
  providerPath = lib.concatStringsSep ":" (
    [
      "${pkgs.git}/bin"
      "${homeDirectory}/.nix-profile/bin"
      "${homeDirectory}/.local/bin"
      "${homeDirectory}/.local/state/nix/profile/bin"
      "/etc/profiles/per-user/paseo-test/bin"
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
    PASEO_LISTEN = "127.0.0.1:6767";
    PASEO_TEST = "coordinated";
    PATH = providerPath;
  };
  server = "${package}/bin/paseo-server";
  serverArguments = [
    server
    "--no-relay"
  ];
  paseoModule = import ../../homeModules/paseo.nix { self.packages.${system}.paseo = package; };
  evaluation = lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      ({ lib, ... }: {
        options = {
          home.homeDirectory = lib.mkOption { type = lib.types.str; };
          home.username = lib.mkOption { type = lib.types.str; };
          home.packages = lib.mkOption {
            type = lib.types.listOf lib.types.package;
            default = [ ];
          };
          home.file = lib.mkOption {
            type = lib.types.attrsOf (
              lib.types.submodule {
                options = {
                  source = lib.mkOption { type = lib.types.path; };
                  onChange = lib.mkOption {
                    type = lib.types.lines;
                    default = "";
                  };
                };
              }
            );
            default = { };
          };
          systemd.user.services = lib.mkOption {
            type = lib.types.attrsOf (
              lib.types.submodule {
                options = {
                  Unit = lib.mkOption {
                    type = lib.types.attrsOf lib.types.raw;
                    default = { };
                  };
                  Service = lib.mkOption {
                    type = lib.types.attrsOf lib.types.raw;
                    default = { };
                  };
                  Install = lib.mkOption {
                    type = lib.types.attrsOf lib.types.raw;
                    default = { };
                  };
                };
              }
            );
            default = { };
          };
          launchd.agents = lib.mkOption {
            type = lib.types.attrsOf (
              lib.types.submodule {
                options = {
                  enable = lib.mkOption {
                    type = lib.types.bool;
                    default = false;
                  };
                  domain = lib.mkOption { type = lib.types.str; };
                  config = lib.mkOption {
                    type = lib.types.attrsOf lib.types.raw;
                    default = { };
                  };
                };
              }
            );
            default = { };
          };
        };

        config.home = {
          inherit homeDirectory;
          username = "paseo-test";
        };
      })
      paseoModule
      {
        services.paseo = {
          enable = true;
          environment.PASEO_TEST = "coordinated";
          extraPackages = [ pkgs.git ];
          relay.enable = false;
          config.proof = {
            enabled = true;
            port = 6767;
          };
        };
      }
    ];
  };
  evaluatedConfig = evaluation.config;
  configFile = evaluatedConfig.home.file.".paseo/config.json";
  commonAssertions = [
    (evaluatedConfig.home.packages == [ package ])
    (lib.hasSuffix "paseo-config.json" (toString configFile.source))
  ];
  platformAssertions =
    if pkgs.stdenv.hostPlatform.isLinux then
      let
        service = evaluatedConfig.systemd.user.services.paseo;
      in
      [
        (service.Unit.X-Restart-Triggers == [ configFile.source ])
        (lib.all (value: builtins.elem value service.Service.Environment) (
          lib.mapAttrsToList (name: value: "${name}=${value}") serviceEnvironment
        ))
        (service.Service.ExecStart == lib.escapeShellArgs serverArguments)
        (service.Service.KillSignal == "SIGTERM")
        (service.Service.Restart == "on-failure")
        (service.Service.RestartSec == 5)
        (service.Service.TimeoutStopSec == 15)
        (service.Install.WantedBy == [ "default.target" ])
      ]
    else if pkgs.stdenv.hostPlatform.isDarwin then
      let
        agent = evaluatedConfig.launchd.agents.paseo;
      in
      [
        agent.enable
        (agent.domain == "user")
        (agent.config.EnvironmentVariables == serviceEnvironment)
        (!agent.config.KeepAlive.SuccessfulExit)
        (agent.config.ProcessType == "Background")
        (agent.config.ProgramArguments == serverArguments)
        agent.config.RunAtLoad
        (agent.config.ThrottleInterval == 5)
        (lib.hasInfix "org.nix-community.home.paseo" configFile.onChange)
      ]
    else
      [ false ];
in
{
  paseoHomeModule =
    assert lib.all (assertion: assertion) (commonAssertions ++ platformAssertions);
    pkgs.runCommand "paseo-home-module-check" { nativeBuildInputs = [ pkgs.jq ]; } ''
      jq -e '.proof == { "enabled": true, "port": 6767 }' ${configFile.source} >/dev/null
      touch "$out"
    '';
}
