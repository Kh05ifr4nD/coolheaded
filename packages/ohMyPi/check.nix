{
  lib,
  package,
  pkgs,
  ...
}:

let
  homeOptions = { lib, ... }: {
    options.home = {
      file = lib.mkOption {
        type = lib.types.attrsOf (
          lib.types.submodule { options.source = lib.mkOption { type = lib.types.path; }; }
        );
        default = { };
      };
      packages = lib.mkOption {
        type = lib.types.listOf lib.types.package;
        default = [ ];
      };
    };
  };
  module = self: import ../../homeModules/ohMyPi.nix { inherit self; };
  enabled = lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      homeOptions
      (module { packages = { }; })
      {
        programs.ohMyPi = {
          enable = true;
          inherit package;
          config.theme.dark = "porcelain";
          models.models.omp = {
            context = 32768;
            provider = "openai";
          };
        };
      }
    ];
  };
  configurationOnly = lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      homeOptions
      (module { packages = throw "self.packages must remain lazy"; })
      {
        programs.ohMyPi = {
          config = pathConfig;
          enable = true;
          models = pathModels;
          package = null;
        };
      }
    ];
  };
  configurationOnlyConfigSource = configurationOnly.config.home.file.".omp/agent/config.yml".source;
  configurationOnlyModelsSource = configurationOnly.config.home.file.".omp/agent/models.yml".source;
  configSource = enabled.config.home.file.".omp/agent/config.yml".source;
  modelsSource = enabled.config.home.file.".omp/agent/models.yml".source;
  pathConfig = "${pkgs.writeText "oh-my-pi-path-config.yml" "theme: path\n"}";
  pathModels = "${pkgs.writeText "oh-my-pi-path-models.yml" "models: {}\n"}";
  expectedConfig = pkgs.writeText "oh-my-pi-expected-config.yml" ''
    theme:
      dark: porcelain
  '';
  expectedModels = pkgs.writeText "oh-my-pi-expected-models.yml" ''
    models:
      omp:
        context: 32768
        provider: openai
  '';
in
{
  ohMyPiHomeModule =
    assert enabled.config.home.packages == [ package ];
    assert configurationOnly.config.home.packages == [ ];
    assert configurationOnlyConfigSource == pathConfig;
    assert configurationOnlyModelsSource == pathModels;
    pkgs.runCommand "oh-my-pi-home-module-check" { } ''
      diff -u ${expectedConfig} ${configSource}
      diff -u ${expectedModels} ${modelsSource}
      touch "$out"
    '';
}
