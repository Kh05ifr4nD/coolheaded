{ base, lib }:

let
  npmTarballName = packageName: lib.last (lib.splitString "/" packageName);

  mkNpmTarballPackage =
    {
      pname,
      packageName ? pname,
      tarballName ? npmTarballName packageName,
      targets ? base.systemTargets,
      asset ? ({ version, ... }: "${tarballName}-${version}.tgz"),
      ...
    }@args:
    base.mkReleaseBinaryPackage (
      removeAttrs args [
        "packageName"
        "tarballName"
      ]
      // {
        inherit asset targets;
        url = { releaseAsset, ... }: "https://registry.npmjs.org/${packageName}/-/${releaseAsset}";
      }
    );
in
{
  inherit mkNpmTarballPackage npmTarballName;
}
