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
      includes = [
        "*.css"
        "*.html"
        "*.js"
        "*.json"
        "*.jsonc"
        "*.jsx"
        "*.less"
        "*.markdown"
        "*.md"
        "*.sass"
        "*.scss"
        "*.ts"
        "*.tsx"
        "*.yaml"
        "*.yml"
      ];
      excludes = rootMarkdown;
      package = config.packages.oxfmt;
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
