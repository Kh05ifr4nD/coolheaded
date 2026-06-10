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
  codexWithoutRipgrep = packages.codex.override { withRipgrep = false; };
  oxlintWithoutTypecheck = packages.oxlint.override { withTypecheck = false; };
}
// lib.optionalAttrs (pkgs.stdenv.hostPlatform.system == "aarch64-linux") {
  mineruWithAll = packages.mineru.override { withAll = true; };
}
// lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
  codexMinimal = packages.codex.override {
    withRipgrep = false;
    withBubblewrap = false;
  };
  codexWithoutBubblewrap = packages.codex.override { withBubblewrap = false; };
}
