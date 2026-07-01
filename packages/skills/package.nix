{
  lib,
  stdenv,
  buildNpmPackage,
  fetchNpmDeps,
  fetchurl,
  git,
  jq,
  makeWrapper,
  nodejs,
  packageLib,
  versionCheckHook,
}:
let
  pname = "skills";

  pin = builtins.fromJSON (builtins.readFile ./pin.json);

  inherit (stdenv.hostPlatform) system;
  packageHash =
    pin.platformPackageHashes.${system}
      or (throw "Missing ${pname} ${pin.version} package hash for ${system}");

  src = fetchurl {
    url = packageLib.npmTarballUrl {
      packageName = pname;
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
  runtimePath = lib.makeBinPath [
    git
    nodejs
  ];
  launcherNames = [
    "add-skill"
    "skills"
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

    packageRoot="$out/libexec/skills"
    mkdir -p "$packageRoot" "$out/bin"
    cp -R bin dist node_modules package.json README.md ThirdPartyNoticeText.txt "$packageRoot/"

    for launcherName in ${lib.concatStringsSep " " launcherNames}; do
      makeWrapper ${nodejs}/bin/node "$out/bin/$launcherName" \
        --add-flags "$packageRoot/bin/cli.mjs" \
        --prefix PATH : "${runtimePath}"
    done

    runHook postInstall
  '';

  doInstallCheck = stdenv.buildPlatform.canExecute stdenv.hostPlatform;
  preVersionCheck = ''
    export HOME="$PWD/versionCheckHome"
    export XDG_CONFIG_HOME="$PWD/versionCheckConfig"
    export TMPDIR="$PWD/versionCheckTmp"
    mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$TMPDIR"
  '';
  versionCheckProgram = "${placeholder "out"}/bin/skills";
  versionCheckProgramArg = "--version";
  versionCheckKeepEnvironment = [
    "HOME"
    "TMPDIR"
    "XDG_CONFIG_HOME"
  ];
  installCheckPhase = ''
    runHook preInstallCheck

    . ${../../lib/package.sh}

    installCheckHome="$PWD/installCheckHome"
    installCheckConfig="$PWD/installCheckConfig"
    installCheckTmp="$PWD/installCheckTmp"
    installCheckProject="$PWD/installCheckProject"
    mkdir -p "$installCheckHome" "$installCheckConfig" "$installCheckTmp" "$installCheckProject"

    assertExecutableSet "$out/bin" add-skill skills

    HOME="$installCheckHome" XDG_CONFIG_HOME="$installCheckConfig" TMPDIR="$installCheckTmp" \
      "$out/bin/skills" --help | grep -q "Usage:"
    HOME="$installCheckHome" XDG_CONFIG_HOME="$installCheckConfig" TMPDIR="$installCheckTmp" \
      "$out/bin/add-skill" --help | grep -q "Usage:"
    (
      cd "$installCheckProject"
      HOME="$installCheckHome" XDG_CONFIG_HOME="$installCheckConfig" TMPDIR="$installCheckTmp" \
        "$out/bin/skills" init smoke-skill > /dev/null
      grep -q "name: smoke-skill" smoke-skill/SKILL.md
    )
    assertFileExists "${packageRoot}/dist/cli.mjs"
    assertFileExists "${packageRoot}/ThirdPartyNoticeText.txt"

    runHook postInstallCheck
  '';

  meta = {
    homepage = "https://github.com/vercel-labs/skills";
    license = lib.licenses.mit;
    description = "CLI for the open agent skills ecosystem";
    mainProgram = "skills";
    platforms = packageLib.supportedSystems;
    sourceProvenance = with lib.sourceTypes; [ fromSource ];
  };
}
