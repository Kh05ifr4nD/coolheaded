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
  cacheDistributionPolicy = import ./cacheDistribution.nix;
  cacheDistributionStatuses = [
    "allow"
    "conditional"
    "denyPendingAudit"
  ];
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
    oxlintMinimal = basePackages.oxlint.override { withTypecheck = false; };
  };
  packages = basePackages // packageVariants;
  packageNames = builtins.attrNames packages;
  policyNames = builtins.attrNames cacheDistributionPolicy;
  invalidPolicyNames = builtins.attrNames (
    lib.filterAttrs (
      _name: status: !(lib.elem status cacheDistributionStatuses)
    ) cacheDistributionPolicy
  );
  packageLicenses = package: lib.toList (package.meta.license or [ ]);
  incompleteLicenseMetadataNames = builtins.attrNames (
    lib.filterAttrs (
      _name: package:
      let
        licenses = packageLicenses package;
      in
      licenses == [ ] || lib.any (license: !(license ? free) || !(license ? redistributable)) licenses
    ) packages
  );
  nonRedistributableAllowedNames = builtins.attrNames (
    lib.filterAttrs (
      name: package:
      cacheDistributionPolicy.${name} == "allow"
      && lib.any (license: !license.redistributable) (packageLicenses package)
    ) packages
  );
  withCacheDistribution =
    name: package:
    package.overrideAttrs (oldAttrs: {
      passthru = (oldAttrs.passthru or { }) // {
        cacheDistribution = cacheDistributionPolicy.${name};
      };
    });
in
if packageNames != policyNames then
  throw "cache distribution policy must cover exactly: ${lib.concatStringsSep ", " packageNames}"
else if invalidPolicyNames != [ ] then
  throw "invalid cache distribution status for: ${lib.concatStringsSep ", " invalidPolicyNames}"
else if incompleteLicenseMetadataNames != [ ] then
  throw "packages need explicit free and redistributable license metadata: ${lib.concatStringsSep ", " incompleteLicenseMetadataNames}"
else if nonRedistributableAllowedNames != [ ] then
  throw "non-redistributable packages cannot use allow: ${lib.concatStringsSep ", " nonRedistributableAllowedNames}"
else
  lib.mapAttrs withCacheDistribution packages
