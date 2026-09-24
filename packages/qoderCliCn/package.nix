{
  lib,
  stdenv,
  autoPatchelfHook,
  packageLib,
}:
packageLib.mkReleaseBinaryPackage {
  pname = "qoder-cli-cn";
  mainProgram = "qoderclicn";

  targets = {
    aarch64-darwin = "qoderclicn-darwin-arm64.tar.gz";
    aarch64-linux = "qoderclicn-linux-arm64.tar.gz";
    x86_64-linux = "qoderclicn-linux-x64.tar.gz";
  };
  asset = { target, ... }: target;
  url =
    { releaseAsset, version, ... }:
    "https://static.qoder.com.cn/qoder-cli-cn/releases/${version}/${releaseAsset}";

  nativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src"
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 qoderclicn "$out/bin/qoderclicn"
    runHook postInstall
  '';

  preVersionCheck = ''
    export HOME="$PWD/versionCheckHome"
    mkdir -p "$HOME"
  '';
  versionCheckKeepEnvironment = [ "HOME" ];

  installCheck.extra = ''
    installCheckHome="$PWD/installCheckHome"
    mkdir -p "$installCheckHome"

    helpOutput="$(HOME="$installCheckHome" "$out/bin/qoderclicn" --help 2>&1)"
    case "$helpOutput" in
      *"Usage: qoderclicn"*) ;;
      *) failCheck "unexpected qoderclicn --help output" ;;
    esac
  '';

  meta = {
    homepage = "https://qoder.cn";
    changelog = "https://qoder.cn/changelog";
    downloadPage = "https://qoder.cn/download";
    license = lib.licenses.unfree;
    description = "Qoder CLI (mainland China edition) - terminal-based AI coding assistant for China-region accounts";
  };
}
