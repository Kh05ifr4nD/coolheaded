{ self }:

{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.ohMyPi;
  yamlFormat = pkgs.formats.yaml { };
  configurationType = lib.types.nullOr (
    lib.types.either (lib.types.attrsOf yamlFormat.type) lib.types.path
  );
  configurationSource =
    name: value: if builtins.isAttrs value then yamlFormat.generate name value else value;
in
{
  options.programs.ohMyPi = {
    enable = lib.mkEnableOption "Oh My Pi coding agent";

    package = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.ohMyPi;
      defaultText = lib.literalExpression "inputs.coolheaded.packages.\${pkgs.stdenv.hostPlatform.system}.ohMyPi";
      description = "Oh My Pi package to install, or null to manage only its configuration.";
    };

    config = lib.mkOption {
      type = configurationType;
      default = null;
      description = ''
        Oh My Pi configuration expressed as a Nix attribute set or as the path
        to a complete YAML configuration file. The result is written to
        {file}`~/.omp/agent/config.yml`.
      '';
      example = lib.literalExpression ''
        {
          theme.dark = "porcelain";
          modelRoles.default = "openai/gpt-5.5";
        }
      '';
    };

    models = lib.mkOption {
      type = configurationType;
      default = null;
      description = ''
        Oh My Pi model registry expressed as a Nix attribute set or as the path
        to a complete YAML file. The result is written to
        {file}`~/.omp/agent/models.yml`.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    home = {
      packages = lib.mkIf (cfg.package != null) [ cfg.package ];

      file = {
        ".omp/agent/config.yml" = lib.mkIf (cfg.config != null) {
          source = configurationSource "oh-my-pi-config.yml" cfg.config;
        };
        ".omp/agent/models.yml" = lib.mkIf (cfg.models != null) {
          source = configurationSource "oh-my-pi-models.yml" cfg.models;
        };
      };
    };
  };
}
