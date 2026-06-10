{
  lib,
  stdenv,
  fzf,
  makeWrapper,
  packageLib,
  ripgrep,
  unzip,
  wrapBuddy,
  writeShellScriptBin,
}:
let
  pname = "opencode";
  releaseTargets = packageLib.npmReleaseTargets;
  wrapperPath = lib.makeBinPath [
    fzf
    ripgrep
  ];
in
packageLib.mkGitHubReleaseBinaryPackage {
  inherit pname;
  owner = "anomalyco";

  targets = releaseTargets;
  asset =
    { target, ... }: "opencode-${target}.${if lib.hasPrefix "darwin" target then "zip" else "tar.gz"}";

  nativeBuildInputs = [
    makeWrapper
  ]
  ++ lib.optionals stdenv.hostPlatform.isDarwin [ unzip ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ wrapBuddy ];
  nativeInstallCheckInputs = lib.optionals stdenv.hostPlatform.isDarwin [
    (writeShellScriptBin "sysctl" ''
      echo 0
    '')
  ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];
  wrapBuddyExtraNeeded = lib.optionals stdenv.hostPlatform.isLinux [ "libstdc++.so.6" ];

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

    packageRoot="$out/libexec/opencode"
    install -Dm755 opencode "$packageRoot/bin/opencode"
    makeWrapper "$packageRoot/bin/opencode" "$out/bin/opencode" \
      --set OPENCODE_DISABLE_AUTOUPDATE true \
      --suffix PATH : ${lib.escapeShellArg wrapperPath}

    runHook postInstall
  '';

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

  installCheck.helpContains = "opencode";

  meta = {
    license = lib.licenses.mit;
    description = "AI coding agent built for the terminal";
  };
}
