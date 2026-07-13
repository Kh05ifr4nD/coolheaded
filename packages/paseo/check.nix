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
  paseoHome = "/tmp/paseo-home-module-${
    builtins.substring 0 12 (builtins.hashString "sha256" package.outPath)
  }";
  settings = {
    version = 1;
    daemon.mcp = {
      enabled = true;
      injectIntoAgents = false;
    };
  };
  settingsFile = (pkgs.formats.json { }).generate "paseo-config.json" settings;
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
    PASEO_HOSTNAMES = ".example.com,localhost.test";
    PASEO_LISTEN = "127.0.0.1:6767";
    PASEO_TEST = "coordinated";
    PATH = providerPath;
  };

  paseoModule = import ../../homeModules/paseo.nix { self.packages.${system}.paseo = package; };
  stubModule = { lib, ... }: {
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
      home.homeDirectory = lib.mkOption { type = lib.types.str; };
      home.username = lib.mkOption { type = lib.types.str; };
      home.packages = lib.mkOption {
        type = lib.types.listOf lib.types.package;
        default = [ ];
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
  };

  mkEvaluation =
    paseoConfig:
    lib.evalModules {
      specialArgs = { inherit pkgs; };
      modules = [
        stubModule
        paseoModule
        { services.paseo = paseoConfig; }
      ];
    };

  evaluation = mkEvaluation {
    enable = true;
    dataDir = paseoHome;
    environment.PASEO_TEST = "coordinated";
    extraPackages = [ pkgs.git ];
    hostnames = [
      ".example.com"
      "localhost.test"
    ];
    relay.enable = false;
    inherit settings;
  };
  evaluatedConfig = evaluation.config;

  remoteEvaluation = mkEvaluation {
    enable = true;
    relay = {
      enable = true;
      host = "relay.example.com";
      mode = "remote";
      port = 8443;
      publicUseTls = true;
      useTls = false;
    };
  };
  conflictingEnvironmentEvaluation = mkEvaluation {
    enable = true;
    environment.PASEO_HOME = "/tmp/conflicting-paseo-home";
  };
  remoteEnvironment =
    if pkgs.stdenv.hostPlatform.isLinux then
      remoteEvaluation.config.systemd.user.services.paseo.Service.Environment
    else
      lib.mapAttrsToList (
        name: value: "${name}=${value}"
      ) remoteEvaluation.config.launchd.agents.paseo.config.EnvironmentVariables;

  commonAssertions = [
    (evaluatedConfig.home.packages == [ package ])
    (builtins.elem "PASEO_RELAY_ENDPOINT=relay.example.com:8443" remoteEnvironment)
    (builtins.elem "PASEO_RELAY_PUBLIC_USE_TLS=true" remoteEnvironment)
    (builtins.elem "PASEO_RELAY_USE_TLS=false" remoteEnvironment)
    (!lib.all (assertion: assertion.assertion) conflictingEnvironmentEvaluation.config.assertions)
  ];
  platformAssertions =
    if pkgs.stdenv.hostPlatform.isLinux then
      let
        service = evaluatedConfig.systemd.user.services.paseo;
      in
      [
        (service.Unit.X-Restart-Triggers == [ settingsFile ])
        (lib.all (value: builtins.elem value service.Service.Environment) (
          lib.mapAttrsToList (name: value: "${name}=${value}") serviceEnvironment
        ))
        (lib.hasSuffix "/bin/paseo-start" service.Service.ExecStart)
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
        (builtins.length agent.config.ProgramArguments == 1)
        (lib.hasSuffix "/bin/paseo-start" (builtins.head agent.config.ProgramArguments))
        agent.config.RunAtLoad
        (agent.config.ThrottleInterval == 5)
      ]
    else
      [ false ];

  startCommand =
    if pkgs.stdenv.hostPlatform.isLinux then
      evaluatedConfig.systemd.user.services.paseo.Service.ExecStart
    else
      builtins.head evaluatedConfig.launchd.agents.paseo.config.ProgramArguments;
in
{
  paseoHomeModule =
    assert lib.all (assertion: assertion) (commonAssertions ++ platformAssertions);
    pkgs.runCommand "paseo-home-module-check"
      {
        nativeBuildInputs = [
          pkgs.coreutils
          pkgs.curl
          pkgs.jq
        ];
      }
      ''
        export CI=true
        export HOME="$TMPDIR/home"
        export PASEO_DICTATION_ENABLED=false
        export PASEO_HOME=${paseoHome}
        export PASEO_LISTEN=127.0.0.1:0
        export PASEO_LOCAL_SPEECH_AUTO_DOWNLOAD=false
        export PASEO_VOICE_MODE_ENABLED=false

        supervisorPid=""
        cleanup() {
          if [[ -n "$supervisorPid" ]]; then
            kill -TERM "$supervisorPid" 2>/dev/null || true
            wait "$supervisorPid" 2>/dev/null || true
          fi
          rm -rf ${paseoHome}
        }
        trap cleanup EXIT

        startAndProbe() {
          : >"$TMPDIR/paseo-server.log"
          ${startCommand} >>"$TMPDIR/paseo-server.log" 2>&1 &
          supervisorPid="$!"

          listen=""
          for attempt in $(seq 1 200); do
            : "$attempt"
            if ! kill -0 "$supervisorPid" 2>/dev/null; then
              cat "$TMPDIR/paseo-server.log" >&2
              return 1
            fi
            if [[ -f ${paseoHome}/paseo.pid ]]; then
              listen="$(jq -r '.listen // empty' ${paseoHome}/paseo.pid)"
            fi
            if [[ -n "$listen" ]] && curl --fail --silent "http://$listen/api/health" >"$TMPDIR/health.json"; then
              break
            fi
            sleep 0.05
          done

          if [[ -z "$listen" ]]; then
            cat "$TMPDIR/paseo-server.log" >&2
            return 1
          fi
          jq -e '.status == "ok"' "$TMPDIR/health.json" >/dev/null
          curl --fail --silent "http://$listen/api/status" >"$TMPDIR/status.json"
          jq -e '.status == "server_info" and .version == "${package.version}"' "$TMPDIR/status.json" >/dev/null
        }

        stopDaemon() {
          kill -TERM "$supervisorPid"
          wait "$supervisorPid"
          supervisorPid=""
        }

        rm -rf ${paseoHome}
        mkdir -p "$HOME"

        startAndProbe
        test -f ${paseoHome}/config.json
        test ! -L ${paseoHome}/config.json
        test "$(stat -c %a ${paseoHome}/config.json)" = 600
        jq -e '.daemon.mcp == { "enabled": true, "injectIntoAgents": false }' ${paseoHome}/config.json >/dev/null
        stopDaemon

        jq '.daemon.mcp.enabled = false' ${paseoHome}/config.json >"$TMPDIR/mutated-config.json"
        install -m 600 "$TMPDIR/mutated-config.json" ${paseoHome}/config.json
        jq -e '.daemon.mcp.enabled == false' ${paseoHome}/config.json >/dev/null

        startAndProbe
        jq -e '.daemon.mcp.enabled == true' ${paseoHome}/config.json >/dev/null
        stopDaemon

        rm -rf ${paseoHome}
        trap - EXIT
        touch "$out"
      '';
}
