{
  callPackage,
  callPackages,
  fetchurl,
  lib,
  packageDirectory ? null,
  pyprojectBuildSystems,
  pyprojectNix,
  stdenv,
  uv2nix,
  versionCheckHook,
}:

let
  base = import ./base.nix {
    inherit
      fetchurl
      lib
      packageDirectory
      stdenv
      versionCheckHook
      ;
  };
  github = import ./github.nix { inherit base; };
  npm = import ./npm.nix { inherit base lib; };
  python = import ./python.nix {
    inherit
      base
      callPackage
      callPackages
      lib
      pyprojectBuildSystems
      pyprojectNix
      uv2nix
      ;
  };
in
base // github // npm // python
