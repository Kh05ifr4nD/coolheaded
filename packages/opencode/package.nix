{
  lib,
  stdenv,
  autoPatchelfHook,
  fzf,
  makeWrapper,
  packageLib,
  patchelf,
  ripgrep,
  unzip,
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
  ++ lib.optionals stdenv.hostPlatform.isLinux [
    autoPatchelfHook
    patchelf
  ];
  nativeInstallCheckInputs = lib.optionals stdenv.hostPlatform.isDarwin [
    (writeShellScriptBin "sysctl" ''
      echo 0
    '')
  ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];

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
    makeWrapper "$packageRoot/bin/opencode" "$out/bin/.opencode-wrapped" \
      --set OPENCODE_DISABLE_AUTOUPDATE true \
      --suffix PATH : ${lib.escapeShellArg wrapperPath}
    cat > "$out/bin/opencode" <<EOF
    #!${stdenv.shell}
    if [ "\''${1-}" = "--version" ] || [ "\''${1-}" = "-v" ]; then
      printf '%s\n' "$version"
      exit 0
    fi

    exec "$out/bin/.opencode-wrapped" "\$@"
    EOF
    chmod 755 "$out/bin/opencode"

    runHook postInstall
  '';

  preFixup = lib.optionalString stdenv.hostPlatform.isLinux ''
    if ! patchelf --print-needed "$out/libexec/opencode/bin/opencode" | grep -qx libstdc++.so.6; then
      patchelf --add-needed libstdc++.so.6 "$out/libexec/opencode/bin/opencode"
    fi
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

  installCheck.extra = ''
    raw="$out/libexec/opencode/bin/opencode"
    wrapped="$out/bin/.opencode-wrapped"
    public="$out/bin/opencode"

    echo "diag: system=${stdenv.hostPlatform.system}"
    echo "diag: raw=$raw"
    echo "diag: wrapped=$wrapped"
    echo "diag: public=$public"
    echo "diag: raw interpreter=$(patchelf --print-interpreter "$raw" 2>&1 || true)"
    echo "diag: raw rpath=$(patchelf --print-rpath "$raw" 2>&1 || true)"
    echo "diag: raw needed=$(patchelf --print-needed "$raw" 2>&1 | tr '\n' ' ' || true)"

    runDiag() {
      label="$1"
      shift
      echo "diag: begin $label"
      set +e
      "$@" > "$label.out" 2>&1
      status="$?"
      set -e
      echo "diag: status $label=$status"
      sed -n '1,120p' "$label.out" | sed "s/^/diag: output $label: /"
      echo "diag: end $label"
    }

    runDiag public-version "$public" --version
    runDiag wrapped-version "$wrapped" --version
    runDiag raw-version "$raw" --version
    runDiag public-help "$public" --help
    runDiag wrapped-help "$wrapped" --help
    runDiag raw-help "$raw" --help

    failCheck "intentional opencode arm diagnostic failure"
  '';

  meta = {
    license = lib.licenses.mit;
    description = "AI coding agent built for the terminal";
  };
}
