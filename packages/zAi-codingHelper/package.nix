{
  lib,
  buildNpmPackage,
  fetchNpmDeps,
  jq,
  makeWrapper,
  nodejs,
  packageLib,
}:
packageLib.mkNpmCliPackage {
  inherit
    buildNpmPackage
    fetchNpmDeps
    jq
    makeWrapper
    nodejs
    ;

  pname = "z-ai-coding-helper";
  packageName = "@z_ai/coding-helper";
  tarballName = "coding-helper";
  cliPath = "dist/cli.js";
  launcherNames = [
    "coding-helper"
    "chelper"
  ];
  installItems = [
    "dist"
    "node_modules"
    "package.json"
    "README.md"
    "zai-coding-plugins"
  ];
  preVersionCheck = ''
    export HOME="$PWD/versionCheckHome"
    export TMPDIR="$PWD/versionCheckTmp"
    mkdir -p "$HOME" "$TMPDIR"
  '';
  versionCheckKeepEnvironment = [
    "HOME"
    "TMPDIR"
  ];
  installCheckExtra = ''
    installCheckHome="$PWD/installCheckHome"
    installCheckTmp="$PWD/installCheckTmp"
    mkdir -p "$installCheckHome" "$installCheckTmp"

    HOME="$installCheckHome" TMPDIR="$installCheckTmp" "$out/bin/coding-helper" --help | grep -q "Coding Tool Helper"
    HOME="$installCheckHome" TMPDIR="$installCheckTmp" "$out/bin/chelper" --version | grep -q "$packageVersion"
    assertFileExists "$packageRoot/dist/cli.js"
    assertFileExists "$packageRoot/zai-coding-plugins/README.md"
  '';
  meta = {
    homepage = "https://docs.z.ai/";
    license = lib.licenses.unfree;
    description = "GLM Coding Plan helper for managing multiple coding tools";
  };
}
