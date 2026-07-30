{
  lib,
  stdenv,
  makeWrapper,
  packageLib,
  unzip,
}:

let
  pname = "gh";
  targets = packageLib.mkTargets [
    "macOS_arm64"
    "linux_arm64"
    "linux_amd64"
  ];
  target = packageLib.releaseTarget pname targets;
in
packageLib.mkGitHubReleaseBinaryPackage {
  inherit pname targets;
  owner = "cli";
  repo = "cli";
  asset =
    { version, ... }:
    "gh_${version}_${target}.${if stdenv.hostPlatform.isDarwin then "zip" else "tar.gz"}";

  nativeBuildInputs = [ makeWrapper ] ++ lib.optionals stdenv.hostPlatform.isDarwin [ unzip ];

  unpackPhase =
    if stdenv.hostPlatform.isDarwin then
      ''
        runHook preUnpack
        unzip -q "$src"
        runHook postUnpack
      ''
    else
      ''
        runHook preUnpack
        tar -xzf "$src"
        runHook postUnpack
      '';

  installPhase = ''
    runHook preInstall

    packageRoot="gh_''${version}_${target}"
    install -Dm755 "$packageRoot/bin/gh" "$out/libexec/gh/bin/gh"
    cp -R "$packageRoot/share" "$out/share"
    makeWrapper "$out/libexec/gh/bin/gh" "$out/bin/gh" \
      --set GH_NO_EXTENSION_UPDATE_NOTIFIER 1 \
      --set GH_NO_UPDATE_NOTIFIER 1 \
      --set GH_TELEMETRY false

    runHook postInstall
  '';

  preVersionCheck = ''
    export GH_CONFIG_DIR="$PWD/versionCheckConfig"
    export HOME="$PWD/versionCheckHome"
    mkdir -p "$GH_CONFIG_DIR" "$HOME"
  '';
  versionCheckKeepEnvironment = [
    "GH_CONFIG_DIR"
    "HOME"
  ];

  installCheck.extra = ''
    installCheckConfig="$PWD/installCheckConfig"
    installCheckHome="$PWD/installCheckHome"
    mkdir -p "$installCheckConfig" "$installCheckHome"

    helpOutput="$(GH_CONFIG_DIR="$installCheckConfig" HOME="$installCheckHome" "$out/bin/gh" help)"
    case "$helpOutput" in
      *"GitHub CLI"*) ;;
      *) failCheck "unexpected gh help output" ;;
    esac

    completionOutput="$(GH_CONFIG_DIR="$installCheckConfig" HOME="$installCheckHome" "$out/bin/gh" completion --shell bash)"
    case "$completionOutput" in
      *"__start_gh"*) ;;
      *) failCheck "unexpected gh Bash completion output" ;;
    esac

    assertFileExists "$out/share/man/man1/gh.1.gz"
  '';

  meta = {
    license = lib.licenses.mit;
    description = "GitHub command-line tool";
  };
}
