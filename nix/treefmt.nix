{ config, ... }:
let
  rootMarkdown = [
    "AGENTS.md"
    "README.md"
  ];
in
{
  programs = {
    deno = {
      enable = true;
      excludes = rootMarkdown;
      package = config.packages.deno;
    };
    nixfmt = {
      enable = true;
      package = config.packages.nixfmt;
      strict = true;
    };
    "rumdl-format" = {
      enable = true;
      includes = rootMarkdown;
      package = config.packages.rumdl;
    };
    shellcheck = {
      enable = true;
      includes = [ "lib/package.sh" ];
      package = config.packages.shellcheck;
    };
    shfmt = {
      enable = true;
      includes = [ "lib/package.sh" ];
      package = config.packages.shfmt;
    };
  };

  settings = {
    excludes = [
      "**/.gitignore"
      "deno.lock"
      "flake.lock"
    ];
  };
}
