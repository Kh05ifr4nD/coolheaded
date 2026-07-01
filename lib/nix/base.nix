{
  fetchurl,
  lib,
  packageDirectory ? null,
  removeReferencesTo,
  stdenv,
  versionCheckHook,
}:

let
  inherit (stdenv.hostPlatform) system;

  systemConfig = builtins.fromJSON (builtins.readFile ../ts/system/targets.json);
  systemTargetsConfig = systemConfig.targets;

  canExecute = stdenv.buildPlatform.canExecute stdenv.hostPlatform;
  isLinux = stdenv.hostPlatform.isLinux;
  packageShell = ../package.sh;
  defaultPinPath =
    if packageDirectory == null then
      throw "packageDirectory is required when pinPath is not set"
    else
      packageDirectory + "/pin.json";

  supportedSystems = map (target: target.system) systemTargetsConfig;

  targetAttrs =
    field:
    lib.listToAttrs (
      map (target: {
        name = target.system;
        value = target.${field};
      }) systemTargetsConfig
    );

  mkTargets =
    targets:
    let
      expectedTargets = builtins.length supportedSystems;
      actualTargets = builtins.length targets;
    in
    if actualTargets != expectedTargets then
      throw "mkTargets expects ${toString expectedTargets} targets, got ${toString actualTargets}"
    else
      lib.listToAttrs (lib.zipListsWith (name: value: { inherit name value; }) supportedSystems targets);

  systemTargets = targetAttrs "system";

  rustTargetTriples = targetAttrs "rustTargetTriple";

  npmReleaseTargets = targetAttrs "npmReleaseTarget";

  releaseTarget =
    pname: targets: targets.${system} or (throw "Unsupported system for ${pname}: ${system}");

  readPin = pinPath: builtins.fromJSON (builtins.readFile pinPath);

  removeSelfReferences = paths: ''
    remove-references-to -t "$out" ${lib.concatStringsSep " " paths}
  '';

  mkInstallCheckPhase =
    {
      executable,
      expectedExecutables ? [ ],
      extra ? "",
      helpContains ? null,
      helpFlag ? "--help",
    }:
    let
      expectedExecutableArguments = lib.escapeShellArgs expectedExecutables;
    in
    ''
      runHook preInstallCheck

      . ${packageShell}

      ${lib.optionalString (expectedExecutables != [ ]) ''
        assertExecutableSet "$out/bin" ${expectedExecutableArguments}
      ''}

      ${lib.optionalString (helpContains != null) ''
        helpOutput="$("${executable}" ${helpFlag} 2>&1)"
        case "$helpOutput" in
          *"${helpContains}"*) ;;
          *) failCheck "unexpected ${executable} ${helpFlag} output" ;;
        esac
      ''}

      ${extra}

      runHook postInstallCheck
    '';

  mkBinaryPackage =
    {
      pname,
      version,
      src,
      meta,
      buildInputs ? [ ],
      binaryVersion ? version,
      doInstallCheck ? canExecute,
      dontUnpack ? false,
      executablePath ? if dontUnpack then "$src" else mainProgram,
      expectedExecutables ? [ mainProgram ],
      installCheck ? { },
      installPhase ? ''
        runHook preInstall
        install -Dm755 ${executablePath} "$out/bin/${mainProgram}"
        runHook postInstall
      '',
      mainProgram ? pname,
      nativeBuildInputs ? [ ],
      nativeInstallCheckInputs ? [ ],
      passthru ? { },
      postFixup ? "",
      preFixup ? "",
      preVersionCheck ? "",
      unpackPhase ? null,
      versionCheckProgram ? "${placeholder "out"}/bin/${mainProgram}",
      versionCheckProgramArg ? "--version",
      versionCheckKeepEnvironment ? [ ],
      wrapBuddyExtraNeeded ? [ ],
    }:
    let
      effectivePreVersionCheck =
        lib.optionalString (binaryVersion != version) ''
          version=${lib.escapeShellArg binaryVersion}
        ''
        + preVersionCheck;
    in
    stdenv.mkDerivation (
      {
        inherit
          buildInputs
          installPhase
          nativeBuildInputs
          pname
          src
          version
          ;

        strictDeps = true;
        __structuredAttrs = true;

        nativeInstallCheckInputs = [ versionCheckHook ] ++ nativeInstallCheckInputs;

        dontConfigure = true;
        dontBuild = true;
        dontStrip = true;

        inherit
          doInstallCheck
          passthru
          versionCheckKeepEnvironment
          versionCheckProgram
          versionCheckProgramArg
          wrapBuddyExtraNeeded
          ;
        installCheckPhase = mkInstallCheckPhase (
          {
            executable = "$out/bin/${mainProgram}";
            inherit expectedExecutables;
          }
          // installCheck
        );

        meta = {
          inherit mainProgram;
          sourceProvenance = with lib.sourceTypes; [ binaryNativeCode ];
        }
        // meta;
      }
      // lib.optionalAttrs dontUnpack { inherit dontUnpack; }
      // lib.optionalAttrs (unpackPhase != null) { inherit unpackPhase; }
      // lib.optionalAttrs (preFixup != "") { inherit preFixup; }
      // lib.optionalAttrs (postFixup != "") { inherit postFixup; }
      // lib.optionalAttrs (effectivePreVersionCheck != "") {
        preVersionCheck = effectivePreVersionCheck;
      }
    );

  mkReleaseBinaryPackage =
    {
      pname,
      asset,
      targets,
      url,
      changelog ? null,
      meta ? { },
      pinPath ? defaultPinPath,
      ...
    }@args:
    let
      pin = readPin pinPath;
      target = releaseTarget pname targets;
      version = pin.version;
      releaseAsset = asset { inherit target version; };
    in
    mkBinaryPackage (
      removeAttrs args [
        "asset"
        "changelog"
        "pinPath"
        "targets"
        "url"
      ]
      // {
        inherit pname version;
        binaryVersion = args.binaryVersion or pin.binaryVersion or version;

        src = fetchurl {
          url = url {
            inherit
              releaseAsset
              system
              target
              version
              ;
          };
          hash =
            pin.platformPackageHashes.${system}
              or (throw "Missing ${pname} ${version} package hash for ${system}");
        };

        meta = {
          platforms = builtins.attrNames targets;
        }
        // lib.optionalAttrs (changelog != null) {
          changelog = changelog {
            inherit
              releaseAsset
              system
              target
              version
              ;
          };
        }
        // meta;
      }
    );
in
{
  inherit
    canExecute
    defaultPinPath
    isLinux
    mkBinaryPackage
    mkInstallCheckPhase
    mkReleaseBinaryPackage
    mkTargets
    npmReleaseTargets
    packageDirectory
    packageShell
    readPin
    releaseTarget
    removeReferencesTo
    removeSelfReferences
    rustTargetTriples
    stdenv
    supportedSystems
    system
    systemTargets
    versionCheckHook
    ;
}
