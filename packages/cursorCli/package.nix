{
  lib,
  stdenv,
  bashInteractive,
  coreutils,
  makeWrapper,
  packageLib,
  wrapBuddy,
  zlib,
}:
let
  pname = "cursor-cli";
  mainProgram = "cursor-agent";

  releaseTargets = packageLib.mkTargets [
    "darwin/arm64"
    "linux/arm64"
    "linux/x64"
  ];

  runtimePath = lib.makeBinPath [
    bashInteractive
    coreutils
  ];
in
packageLib.mkReleaseBinaryPackage {
  inherit pname mainProgram;

  targets = releaseTargets;
  asset = { ... }: "agent-cli-package.tar.gz";
  url =
    { target, version, ... }:
    "https://downloads.cursor.com/lab/${version}/${target}/agent-cli-package.tar.gz";

  nativeBuildInputs = [ makeWrapper ] ++ lib.optionals stdenv.hostPlatform.isLinux [ wrapBuddy ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    stdenv.cc.cc.lib
    zlib
  ];

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src"
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall

    packageRoot="$out/libexec/cursor-cli"
    mkdir -p "$packageRoot" "$out/bin"
    cp -R dist-package/. "$packageRoot/"
    substituteInPlace "$packageRoot/cursor-agent" \
      --replace-fail '#!/usr/bin/env bash' '#!${bashInteractive}/bin/bash'
    chmod +x "$packageRoot/cursor-agent" "$packageRoot/node" "$packageRoot/rg"

    makeWrapper "$packageRoot/cursor-agent" "$out/bin/cursor-agent" \
      --prefix PATH : "$packageRoot:${runtimePath}"

    runHook postInstall
  '';

  expectedExecutables = [ "cursor-agent" ];
  preVersionCheck = ''
    export HOME="$PWD/versionCheckHome"
    export TMPDIR="$PWD/versionCheckTmp"
    mkdir -p "$HOME" "$TMPDIR"
  '';
  versionCheckKeepEnvironment = [
    "HOME"
    "PATH"
    "TMPDIR"
  ];
  installCheck = {
    helpContains = "Usage:";
    extra = ''
      test ! -L "$out/bin/cursor-agent" || failCheck "expected wrapped cursor-agent launcher"
      assertExecutableExists "$out/libexec/cursor-cli/cursor-agent"
      assertExecutableExists "$out/libexec/cursor-cli/node"
      assertExecutableExists "$out/libexec/cursor-cli/rg"
    '';
  };

  meta = {
    homepage = "https://cursor.com/cli";
    license = lib.licenses.unfree;
    description = "Command-line agent for Cursor";
  };
}
