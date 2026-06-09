{
  lib,
  pkgs,
  bun2nix,
  pyprojectBuildSystems,
  pyprojectNix,
  uv2nix,
}:

import ./packageSet.nix {
  inherit
    lib
    pkgs
    bun2nix
    pyprojectBuildSystems
    pyprojectNix
    uv2nix
    ;
}
