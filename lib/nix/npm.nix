{
  base,
  fetchurl,
  lib,
  versionCheckHook,
}:

let
  defaultPackageLock =
    if base.packageDirectory == null then
      throw "packageDirectory is required when packageLock is not set"
    else
      base.packageDirectory + "/package-lock.json";

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

  mkNpmCliPackage =
    {
      buildNpmPackage,
      fetchNpmDeps,
      installCheckExtra,
      installItems,
      jq,
      launcherNames,
      makeWrapper,
      meta,
      nodejs,
      pname,
      cliPath,
      extraNativeBuildInputs ? [ ],
      mainProgram ? builtins.head launcherNames,
      npmInstallFlags ? [ "--omit=dev" ],
      packageLock ? defaultPackageLock,
      packageName ? pname,
      pinPath ? base.defaultPinPath,
      preVersionCheck ? "",
      runtimeInputs ? [ nodejs ],
      tarballName ? npmTarballName packageName,
      versionCheckKeepEnvironment ? [ ],
      versionCheckProgramArg ? "--version",
    }:
    let
      pin = base.readPin pinPath;
      packageHash =
        pin.platformPackageHashes.${base.system}
          or (throw "Missing ${pname} ${pin.version} package hash for ${base.system}");
      src = fetchurl {
        url = npmTarballUrl {
          inherit packageName tarballName;
          version = pin.version;
        };
        hash = packageHash;
      };
      syncPackageLock = syncPackageJsonFromPackageLock {
        inherit packageLock;
        deleteScripts = true;
      };
      npmDeps = fetchNpmDeps {
        name = "${pname}-${pin.version}-npm-deps";
        inherit src;
        hash = pin.npmVendorHash;
        nativeBuildInputs = [ jq ];
        postPatch = syncPackageLock;
      };
      packageRoot = "${placeholder "out"}/libexec/${pname}";
      runtimePath = lib.makeBinPath runtimeInputs;
    in
    buildNpmPackage {
      inherit
        npmDeps
        pname
        src
        versionCheckKeepEnvironment
        versionCheckProgramArg
        ;
      inherit (pin) version;

      strictDeps = true;
      __structuredAttrs = true;

      nativeBuildInputs = [
        jq
        makeWrapper
      ]
      ++ extraNativeBuildInputs;
      nativeInstallCheckInputs = [ versionCheckHook ];

      postPatch = ''
        ${syncPackageLock}
      '';

      inherit npmInstallFlags;
      dontNpmBuild = true;

      installPhase = ''
        runHook preInstall

        packageRoot="${packageRoot}"
        mkdir -p "$packageRoot" "$out/bin"
        cp -R ${lib.escapeShellArgs installItems} "$packageRoot/"

        for launcherName in ${lib.escapeShellArgs launcherNames}; do
          makeWrapper ${nodejs}/bin/node "$out/bin/$launcherName" \
            --add-flags "$packageRoot/${cliPath}" \
            --prefix PATH : "${runtimePath}"
        done

        runHook postInstall
      '';

      doInstallCheck = base.canExecute;
      inherit preVersionCheck;
      versionCheckProgram = "${placeholder "out"}/bin/${mainProgram}";
      installCheckPhase = ''
        runHook preInstallCheck

        . ${base.packageShell}
        packageRoot="${packageRoot}"
        packageVersion=${lib.escapeShellArg pin.version}

        assertExecutableSet "$out/bin" ${lib.escapeShellArgs launcherNames}

        ${installCheckExtra}

        runHook postInstallCheck
      '';

      meta = {
        inherit mainProgram;
        platforms = base.supportedSystems;
        sourceProvenance = with lib.sourceTypes; [ fromSource ];
      }
      // meta;
    };

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
    mkNpmCliPackage
    mkNpmTarballPackage
    npmTarballName
    npmTarballUrl
    syncPackageJsonFromPackageLock
    ;
}
