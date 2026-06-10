{
  lib,
  pkgs,
  bun2nix,
  pyprojectBuildSystems,
  pyprojectNix,
  uv2nix,
  wrapBuddy,
}:

import ./packageSet.nix {
  inherit
    lib
    pkgs
    bun2nix
    pyprojectBuildSystems
    pyprojectNix
    uv2nix
    wrapBuddy
    ;
}
