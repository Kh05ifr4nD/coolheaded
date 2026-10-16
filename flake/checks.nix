{
  inputs,
  lib,
  packages,
  pkgs,
}:

let
  incompleteLicenseMetadataNames = builtins.attrNames (
    lib.filterAttrs (
      _name: package:
      let
        licenses = lib.toList (package.meta.license or [ ]);
      in
      licenses == [ ] || lib.any (license: !(license ? free) || !(license ? redistributable)) licenses
    ) packages
  );
  packageCheckPath = name: ../packages + "/${name}/check.nix";
  packageNames = builtins.attrNames (
    lib.filterAttrs (
      name: type: type == "directory" && builtins.pathExists (../packages + "/${name}/package.nix")
    ) (builtins.readDir ../packages)
  );
  packageCheckOutputs = map (name: {
    owner = name;
    checks = import (packageCheckPath name) {
      inherit lib packages pkgs;
      package = packages.${name};
    };
  }) (lib.filter (name: builtins.pathExists (packageCheckPath name)) packageNames);
  checkNameState =
    lib.foldl'
      (
        state:
        { checks, ... }:
        let
          names = builtins.attrNames checks;
        in
        {
          seen = state.seen ++ names;
          duplicates = state.duplicates ++ lib.filter (name: lib.elem name state.seen) names;
        }
      )
      {
        seen = [ ];
        duplicates = [ ];
      }
      packageCheckOutputs;
  checkNames = checkNameState.seen;
  duplicateCheckNames = lib.unique checkNameState.duplicates;
  packageVsCheckNames = lib.intersectLists (builtins.attrNames packages) checkNames;
  builtinCheckConflicts = lib.intersectLists [ "denoDependencies" "evaluation" ] (
    builtins.attrNames packages ++ checkNames
  );
  packageChecks = lib.foldl' (merged: { checks, ... }: merged // checks) { } packageCheckOutputs;
  denoDependencies = import ./denoDependencies.nix {
    inherit pkgs;
    inherit (pkgs) lib;
    deno = pkgs.deno;
  };
  evaluation = import ./evaluation.nix {
    inherit
      inputs
      lib
      packages
      pkgs
      ;
  };
in
if incompleteLicenseMetadataNames != [ ] then
  throw "packages need explicit free and redistributable license metadata: ${lib.concatStringsSep ", " incompleteLicenseMetadataNames}"
else if duplicateCheckNames != [ ] then
  throw "check-vs-check name conflicts: ${lib.concatStringsSep ", " duplicateCheckNames}"
else if packageVsCheckNames != [ ] then
  throw "package-vs-check name conflicts: ${lib.concatStringsSep ", " packageVsCheckNames}"
else if builtinCheckConflicts != [ ] then
  throw "built-in check name conflicts: ${lib.concatStringsSep ", " builtinCheckConflicts}"
else
  packages // packageChecks // { inherit denoDependencies evaluation; }
