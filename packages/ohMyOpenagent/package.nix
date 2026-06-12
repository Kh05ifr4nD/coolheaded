{
  lib,
  stdenv,
  bun,
  fetchurl,
  makeWrapper,
  nodejs,
  packageLib,
}:
let
  pname = "oh-my-openagent";
  pin = builtins.fromJSON (builtins.readFile ./pin.json);
  releaseTargets = packageLib.npmReleaseTargets;
  platformTarget = packageLib.releaseTarget pname releaseTargets;
  mainSrc = fetchurl {
    url = "https://registry.npmjs.org/oh-my-openagent/-/oh-my-openagent-${pin.version}.tgz";
    hash = pin.hash;
  };
  platformSrc = fetchurl {
    url = "https://registry.npmjs.org/oh-my-openagent-${platformTarget}/-/oh-my-openagent-${platformTarget}-${pin.version}.tgz";
    hash =
      pin.hashes.${stdenv.hostPlatform.system}
        or (throw "Missing ${pname} ${pin.version} platform hash for ${stdenv.hostPlatform.system}");
  };
  packageRoot = "${placeholder "out"}/libexec/${pname}";
  nodePath = lib.makeBinPath [
    bun
    nodejs
  ];
in
packageLib.mkBinaryPackage {
  inherit pname;
  version = pin.version;

  src = mainSrc;

  nativeBuildInputs = [ makeWrapper ];

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src" --strip-components=1
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall

    packageRoot="$out/libexec/oh-my-openagent"
    platformRoot="$TMPDIR/platform-package"
    mkdir -p "$packageRoot" "$platformRoot" "$out/bin"

    cp -R . "$packageRoot/"
    rm -f "$packageRoot/.attrs.json" "$packageRoot/.attrs.sh" "$packageRoot/env-vars"
    rm -rf "$packageRoot/packages/omo-codex"

    tar -xzf "${platformSrc}" --strip-components=1 -C "$platformRoot"
    install -Dm755 "$platformRoot/bin/oh-my-opencode.js" "$packageRoot/launcher/oh-my-openagent.js"
    makeWrapper ${lib.getExe nodejs} "$out/bin/oh-my-openagent" \
      --add-flags "$packageRoot/launcher/oh-my-openagent.js" \
      --set OMO_INVOCATION_NAME "oh-my-openagent" \
      --set OMO_WRAPPER_PACKAGE_ROOT "$packageRoot" \
      --set BUN_BINARY ${lib.getExe bun} \
      --prefix PATH : ${lib.escapeShellArg nodePath}

    runHook postInstall
  '';

  preVersionCheck = ''
    export HOME="$PWD/installCheckHome"
    export XDG_CONFIG_HOME="$PWD/installCheckConfig"
    export TMPDIR="$PWD/installCheckTmp"
    mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$TMPDIR"
  '';
  versionCheckKeepEnvironment = [
    "HOME"
    "XDG_CONFIG_HOME"
    "TMPDIR"
  ];
  versionCheckProgramArg = "--version";

  installCheck.helpContains = "Usage";
  installCheck.extra = ''
    test ! -e "${packageRoot}/packages/omo-codex" || failCheck "unexpected omo-codex payload"
    test ! -e "$out/bin/oh-my-opencode" || failCheck "unexpected oh-my-opencode launcher"
    test ! -e "$out/bin/omo" || failCheck "unexpected omo launcher"
    test ! -e "$out/bin/lazycodex" || failCheck "unexpected lazycodex launcher"
    assertFileExists "${packageRoot}/launcher/oh-my-openagent.js"
    assertFileExists "${packageRoot}/dist/cli/index.js"
    assertFileExists "${packageRoot}/.agents/skills"
    assertFileExists "${packageRoot}/.opencode/skills"
    assertFileExists "${packageRoot}/packages/ast-grep-mcp/dist/cli.js"
    assertFileExists "${packageRoot}/packages/git-bash-mcp/dist/cli.js"
    assertFileExists "${packageRoot}/packages/lsp-tools-mcp/dist/cli.js"
    assertFileExists "${packageRoot}/packages/shared-skills/skills"
  '';

  meta = {
    homepage = "https://github.com/code-yeongyu/oh-my-openagent";
    changelog = "https://github.com/code-yeongyu/oh-my-openagent/releases/tag/v${pin.version}";
    license = lib.licenses.unfree;
    platforms = packageLib.supportedSystems;
    sourceProvenance = with lib.sourceTypes; [ binaryNativeCode ];
    description = "OpenCode plugin and agent bundle";
  };
}
