{ self }:

{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.codex;
  tomlFormat = pkgs.formats.toml { };
  rawConfig = cfg.config != null && !builtins.isAttrs cfg.config;
  supportsToml = cfg.package == null || lib.versionAtLeast (lib.getVersion cfg.package) "0.2.0";
  configDirectory =
    if config.home.preferXdgDirectories then
      "${lib.removePrefix config.home.homeDirectory config.xdg.configHome}/codex"
    else
      ".codex";
in
{
  options.programs.codex.config = lib.mkOption {
    type = lib.types.nullOr (lib.types.either (lib.types.attrsOf tomlFormat.type) lib.types.path);
    default = null;
    description = ''
      Codex configuration expressed as a Nix attribute set or as the path to
      a complete TOML configuration file. Attribute sets are merged into the
      upstream Home Manager Codex settings and written to
      {file}`CODEX_HOME/config.toml`.
    '';
    example = lib.literalExpression ''
      {
        model = "gpt-5.5";
        model_reasoning_effort = "xhigh";
        approval_policy = "on-request";
      }
    '';
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.config == null || supportsToml;
        message = "`programs.codex.config` requires Codex 0.2.0 or later";
      }
      {
        assertion = !rawConfig || cfg.settings == { };
        message = "`programs.codex.config` as a TOML path cannot be combined with `programs.codex.settings`";
      }
      {
        assertion = !rawConfig || !cfg.enableMcpIntegration;
        message = "`programs.codex.config` as a TOML path cannot be combined with `programs.codex.enableMcpIntegration`";
      }
      {
        assertion = !rawConfig || (cfg.plugins == [ ] && cfg.marketplaces == { });
        message = "`programs.codex.config` as a TOML path cannot be combined with Codex plugins or marketplaces";
      }
    ];

    programs.codex = {
      package = lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.codex;
      settings = lib.mkIf (cfg.config != null && !rawConfig) cfg.config;
    };

    home.file."${configDirectory}/config.toml" = lib.mkIf rawConfig { source = cfg.config; };
  };
}
