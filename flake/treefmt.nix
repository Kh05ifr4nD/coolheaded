{ config, pkgs }:
let
  rootMarkdown = [
    "AGENTS.md"
    "README.md"
  ];
in
{
  programs = {
    cue.enable = true;
    nixfmt = {
      enable = true;
      package = pkgs.nixfmt;
      strict = true;
    };
    oxfmt = {
      enable = true;
      excludes = rootMarkdown;
      package = config.packages.oxfmt;
    };
    "rumdl-format" = {
      enable = true;
      includes = rootMarkdown;
      package = pkgs.rumdl;
    };
    shfmt = {
      enable = true;
      includes = [ "lib/package.sh" ];
      package = pkgs.shfmt;
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
