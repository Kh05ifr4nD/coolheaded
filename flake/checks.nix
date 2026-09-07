{
  lib,
  packages,
  pkgs,
}:

let
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
  denoDependenciesConflicts = lib.intersectLists [ "denoDependencies" ] (
    builtins.attrNames packages ++ checkNames
  );
  packageChecks = lib.foldl' (merged: { checks, ... }: merged // checks) { } packageCheckOutputs;
  denoDependencies = import ./denoDependencies.nix {
    inherit pkgs;
    inherit (pkgs) lib;
    deno = pkgs.deno;
  };
in
if duplicateCheckNames != [ ] then
  throw "check-vs-check name conflicts: ${lib.concatStringsSep ", " duplicateCheckNames}"
else if packageVsCheckNames != [ ] then
  throw "package-vs-check name conflicts: ${lib.concatStringsSep ", " packageVsCheckNames}"
else if denoDependenciesConflicts != [ ] then
  throw "denoDependencies name conflicts: ${lib.concatStringsSep ", " denoDependenciesConflicts}"
else
  packages // packageChecks // { inherit denoDependencies; }
