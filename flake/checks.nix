{
  lib,
  pkgs,
  bun2nix,
  pyprojectBuildSystems,
  pyprojectNix,
  uv2nix,
  wrapBuddy,
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
      wrapBuddy
      ;
  };
  packageCheckPath = name: ../packages + "/${name}/checks.nix";
  packageChecks = lib.concatMapAttrs (
    name: package:
    if builtins.pathExists (packageCheckPath name) then
      import (packageCheckPath name) {
        inherit
          lib
          package
          packages
          pkgs
          ;
      }
    else
      { }
  ) packages;
in
packages // packageChecks
