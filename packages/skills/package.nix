{
  lib,
  buildNpmPackage,
  fetchNpmDeps,
  git,
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

  pname = "skills";
  cliPath = "bin/cli.mjs";
  launcherNames = [
    "add-skill"
    "skills"
  ];
  mainProgram = "skills";
  installItems = [
    "bin"
    "dist"
    "node_modules"
    "package.json"
    "README.md"
    "ThirdPartyNoticeText.txt"
  ];
  runtimeInputs = [
    git
    nodejs
  ];
  preVersionCheck = ''
    export HOME="$PWD/versionCheckHome"
    export XDG_CONFIG_HOME="$PWD/versionCheckConfig"
    export TMPDIR="$PWD/versionCheckTmp"
    mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$TMPDIR"
  '';
  versionCheckKeepEnvironment = [
    "HOME"
    "TMPDIR"
    "XDG_CONFIG_HOME"
  ];
  installCheckExtra = ''
    installCheckHome="$PWD/installCheckHome"
    installCheckConfig="$PWD/installCheckConfig"
    installCheckTmp="$PWD/installCheckTmp"
    installCheckProject="$PWD/installCheckProject"
    mkdir -p "$installCheckHome" "$installCheckConfig" "$installCheckTmp" "$installCheckProject"

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
    assertFileExists "$packageRoot/dist/cli.mjs"
    assertFileExists "$packageRoot/ThirdPartyNoticeText.txt"
  '';
  meta = {
    homepage = "https://github.com/vercel-labs/skills";
    license = lib.licenses.mit;
    description = "CLI for the open agent skills ecosystem";
  };
}
