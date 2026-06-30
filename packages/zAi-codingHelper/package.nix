{
  lib,
  stdenv,
  buildNpmPackage,
  fetchNpmDeps,
  fetchurl,
  jq,
  makeWrapper,
  nodejs,
  packageLib,
  versionCheckHook,
}:
let
  pname = "z-ai-coding-helper";
  npmPackageName = "@z_ai/coding-helper";

  pin = builtins.fromJSON (builtins.readFile ./pin.json);

  inherit (stdenv.hostPlatform) system;
  packageHash =
    pin.platformPackageHashes.${system}
      or (throw "Missing ${pname} ${pin.version} package hash for ${system}");

  src = fetchurl {
    url = packageLib.npmTarballUrl {
      packageName = npmPackageName;
      version = pin.version;
    };
    hash = packageHash;
  };

  syncPackageLock = packageLib.syncPackageJsonFromPackageLock {
    packageLock = ./package-lock.json;
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
  nodePath = lib.makeBinPath [ nodejs ];
  launcherNames = [
    "coding-helper"
    "chelper"
  ];
in
buildNpmPackage {
  inherit pname src npmDeps;
  inherit (pin) version;

  strictDeps = true;
  __structuredAttrs = true;

  nativeBuildInputs = [
    jq
    makeWrapper
  ];
  nativeInstallCheckInputs = [ versionCheckHook ];

  postPatch = ''
    ${syncPackageLock}
  '';

  npmInstallFlags = [ "--omit=dev" ];
  dontNpmBuild = true;

  installPhase = ''
    runHook preInstall

    packageRoot="$out/libexec/z-ai-coding-helper"
    mkdir -p "$packageRoot" "$out/bin"
    cp -R dist node_modules package.json README.md zai-coding-plugins "$packageRoot/"

    for launcherName in ${lib.concatStringsSep " " launcherNames}; do
      makeWrapper ${nodejs}/bin/node "$out/bin/$launcherName" \
        --add-flags "$packageRoot/dist/cli.js" \
        --prefix PATH : "${nodePath}"
    done

    runHook postInstall
  '';

  doInstallCheck = stdenv.buildPlatform.canExecute stdenv.hostPlatform;
  preVersionCheck = ''
    export HOME="$PWD/versionCheckHome"
    export TMPDIR="$PWD/versionCheckTmp"
    mkdir -p "$HOME" "$TMPDIR"
  '';
  versionCheckProgram = "${placeholder "out"}/bin/coding-helper";
  versionCheckProgramArg = "--version";
  versionCheckKeepEnvironment = [
    "HOME"
    "TMPDIR"
  ];
  installCheckPhase = ''
    runHook preInstallCheck

    . ${../../lib/package.sh}

    installCheckHome="$PWD/installCheckHome"
    installCheckTmp="$PWD/installCheckTmp"
    mkdir -p "$installCheckHome" "$installCheckTmp"

    HOME="$installCheckHome" TMPDIR="$installCheckTmp" "$out/bin/coding-helper" --help | grep -q "Coding Tool Helper"
    HOME="$installCheckHome" TMPDIR="$installCheckTmp" "$out/bin/chelper" --version | grep -q '${pin.version}'
    assertFileExists "${packageRoot}/dist/cli.js"
    assertFileExists "${packageRoot}/zai-coding-plugins/README.md"

    runHook postInstallCheck
  '';

  meta = {
    homepage = "https://docs.z.ai/";
    license = lib.licenses.unfree;
    description = "GLM Coding Plan helper for managing multiple coding tools";
    mainProgram = "coding-helper";
    platforms = packageLib.supportedSystems;
    sourceProvenance = with lib.sourceTypes; [ fromSource ];
  };
}
