{ base, lib }:

let
  npmTarballName = packageName: lib.last (lib.splitString "/" packageName);

  npmTarballUrl =
    {
      packageName,
      tarballName ? npmTarballName packageName,
      version,
    }:
    "https://registry.npmjs.org/${packageName}/-/${tarballName}-${version}.tgz";

  syncPackageJsonFromPackageLock =
    {
      packageLock,
      deleteScripts ? false,
    }:
    ''
      jq --slurpfile packageLock ${packageLock} '
        ($packageLock[0].packages[""] // {}) as $root
        | .dependencies = ($root.dependencies // {})
        | if $root.optionalDependencies then
            .optionalDependencies = $root.optionalDependencies
          else
            del(.optionalDependencies)
          end
        | if $root.peerDependencies then
            .peerDependencies = $root.peerDependencies
          else
            del(.peerDependencies)
          end
        | del(.devDependencies)
        ${lib.optionalString deleteScripts "| del(.scripts)"}
      ' package.json > package.json.tmp
      mv package.json.tmp package.json
      cp ${packageLock} package-lock.json
    '';

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
  inherit
    mkNpmTarballPackage
    npmTarballName
    npmTarballUrl
    syncPackageJsonFromPackageLock
    ;
}
