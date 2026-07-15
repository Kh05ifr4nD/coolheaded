{
  lib,
  packages,
  pkgs,
}:

let
  packageCheckPath = name: ../packages + "/${name}/check.nix";
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
  denoDependencies = import ./denoDependencies.nix {
    inherit pkgs;
    inherit (pkgs) lib;
    deno = packages.deno;
  };
in
packages // packageChecks // { inherit denoDependencies; }
