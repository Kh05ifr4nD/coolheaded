{ config, ... }:
let
  rootMarkdown = [
    "AGENTS.md"
    "README.md"
  ];
in
{
  programs = {
    nixfmt = {
      enable = true;
      package = config.packages.nixfmt;
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
      package = config.packages.rumdl;
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
