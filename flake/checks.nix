{
  lib,
  pkgs,
  bun2nix,
  pyprojectBuildSystems,
  pyprojectNix,
  uv2nix,
}:

let
  packages = import ./packageSet.nix {
    inherit
      lib
      pkgs
      bun2nix
      pyprojectBuildSystems
      pyprojectNix
      uv2nix
      ;
  };
in
packages
// {
  mineruWithAll = packages.mineru.override { withAll = true; };
  oxlintWithoutTypecheck = packages.oxlint.override { withTypecheck = false; };
}
// lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
  codexMinimal = packages.codex.override {
    withRipgrep = false;
    withBubblewrap = false;
  };
}
