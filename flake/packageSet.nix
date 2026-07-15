{
  lib,
  pkgs,
  bun2nix,
  pyprojectBuildSystems,
  pyprojectNix,
  uv2nix,
  wrapBuddy,
  packageArgs ? { },
}:

let
  packageDirectories = lib.filterAttrs (
    name: type: type == "directory" && builtins.pathExists (../packages + "/${name}/package.nix")
  ) (builtins.readDir ../packages);
  bunPackageArgs = {
    bun2nix = bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
  };
  pyprojectPackageArgs = { inherit pyprojectBuildSystems pyprojectNix uv2nix; };
  wrapBuddyPackageArgs = {
    wrapBuddy = wrapBuddy.packages.${pkgs.stdenv.hostPlatform.system}.wrapBuddy or null;
  };
  packageDirectory = name: ../packages + "/${name}";
  packageUpdateScript = name: packageDirectory name + "/update.ts";
  withUpdateScript =
    name: package:
    if builtins.pathExists (packageUpdateScript name) then
      package.overrideAttrs (oldAttrs: {
        passthru = (oldAttrs.passthru or { }) // {
          updateScript = packageUpdateScript name;
        };
      })
    else
      package;
  withoutUpdateScript =
    package:
    package.overrideAttrs (oldAttrs: {
      passthru = builtins.removeAttrs (oldAttrs.passthru or { }) [ "updateScript" ];
    });
  packageLibArgs = name: {
    packageLib = import ../lib/nix/default.nix {
      inherit (pkgs)
        callPackage
        callPackages
        fetchurl
        removeReferencesTo
        stdenv
        versionCheckHook
        ;
      inherit (pkgs) lib;
      inherit pyprojectBuildSystems pyprojectNix uv2nix;
      packageDirectory = packageDirectory name;
    };
  };
  packageDirectoryArgs =
    name:
    let
      packageFunction = import (packageDirectory name + "/package.nix");
      packageFunctionArgs = builtins.functionArgs packageFunction;
    in
    lib.optionalAttrs (packageFunctionArgs ? bun2nix) bunPackageArgs
    // lib.optionalAttrs (packageFunctionArgs ? packageLib) (packageLibArgs name)
    // lib.optionalAttrs (packageFunctionArgs ? wrapBuddy) wrapBuddyPackageArgs
    // lib.optionalAttrs (
      (packageFunctionArgs ? pyprojectBuildSystems)
      || (packageFunctionArgs ? pyprojectNix)
      || (packageFunctionArgs ? uv2nix)
    ) pyprojectPackageArgs
    // (packageArgs.${name} or { });
  basePackages = lib.fix (
    packages:
    lib.mapAttrs (
      name: _type:
      let
        packageFunction = import (packageDirectory name + "/package.nix");
        package = pkgs.callPackage packageFunction (
          packageDirectoryArgs name
          // lib.optionalAttrs ((builtins.functionArgs packageFunction) ? coolheaded) {
            coolheaded = packages;
          }
        );
      in
      withUpdateScript name package
    ) packageDirectories
  );
  packageVariants = lib.mapAttrs (_name: package: withoutUpdateScript package) {
    codexMinimal = basePackages.codex.override {
      withBubblewrap = false;
      withRipgrep = false;
    };
    minerUFull = basePackages.minerU.override { withAll = true; };
    openVikingFull = basePackages.openViking.override { withAll = true; };
    oxlintMinimal = basePackages.oxlint.override { withTypecheck = false; };
  };
in
basePackages // packageVariants
