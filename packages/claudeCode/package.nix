{
  lib,
  stdenv,
  alsa-lib,
  autoPatchelfHook,
  bubblewrap,
  makeWrapper,
  packageLib,
  procps,
  ripgrep,
  socat,
  disableTelemetry ? false,
  withRipgrep ? true,
}:
let
  pname = "claude-code";
  pin = packageLib.readPin ./pin.json;
  runtimeCommands = [
    procps
  ]
  ++ lib.optionals withRipgrep [ ripgrep ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [
    bubblewrap
    socat
  ];
  wrapperArgs = [
    "--argv0"
    "claude"
    "--set"
    "DISABLE_AUTOUPDATER"
    "1"
    "--set"
    "DISABLE_INSTALLATION_CHECKS"
    "1"
    "--prefix"
    "PATH"
    ":"
    (lib.makeBinPath runtimeCommands)
  ]
  ++ lib.optionals withRipgrep [
    "--set"
    "USE_BUILTIN_RIPGREP"
    "0"
  ]
  ++ lib.optionals disableTelemetry [
    "--set"
    "DISABLE_TELEMETRY"
    "1"
    "--set"
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"
    "1"
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [
    "--prefix"
    "LD_LIBRARY_PATH"
    ":"
    (lib.makeLibraryPath [ alsa-lib ])
  ];
  searchLabel = if withRipgrep then lib.getExe ripgrep else "bundled";
  claudeCode = packageLib.mkReleaseBinaryPackage {
    inherit pname;
    mainProgram = "claude";

    targets = {
      aarch64-darwin = "darwin-arm64";
      aarch64-linux = "linux-arm64";
      x86_64-linux = "linux-x64";
    };
    asset = _: "claude";
    url =
      { target, version, ... }:
      "https://downloads.claude.ai/claude-code-releases/${version}/${target}/claude";
    changelog =
      { version, ... }: "https://github.com/anthropics/claude-code/blob/v${version}/CHANGELOG.md";

    nativeBuildInputs = [
      makeWrapper
    ]
    ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
    buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ alsa-lib ];

    dontUnpack = true;

    installPhase = ''
      runHook preInstall

      install -Dm755 "$src" "$out/libexec/claude-code/claude"
      makeWrapper "$out/libexec/claude-code/claude" "$out/bin/claude" \
        ${lib.escapeShellArgs wrapperArgs}

      runHook postInstall
    '';

    preVersionCheck = ''
      export HOME="$PWD/versionCheckHome"
      mkdir -p "$HOME"
    '';
    versionCheckKeepEnvironment = [ "HOME" ];

    installCheck = {
      helpContains = "Usage: claude";
      extra = ''
        installCheckHome="$PWD/installCheckHome"
        installCheckTmp="$PWD/installCheckTmp"
        mkdir -p "$installCheckHome" "$installCheckTmp"

        assertFileExists "$out/libexec/claude-code/claude"

        doctorOutput="$(HOME="$installCheckHome" TMPDIR="$installCheckTmp" "$out/bin/claude" doctor 2>&1)"
        case "$doctorOutput" in
          *"Running: native (${pin.version})"*) ;;
          *) failCheck "claude doctor did not report the packaged native build" ;;
        esac
        case "$doctorOutput" in
          *"Auto-updates: disabled"*) ;;
          *) failCheck "claude doctor left auto-updates enabled" ;;
        esac
        case "$doctorOutput" in
          *"Search: OK (${searchLabel})"*) ;;
          *) failCheck "claude doctor did not use the selected search backend" ;;
        esac

        mcpOutput="$(HOME="$installCheckHome" TMPDIR="$installCheckTmp" "$out/bin/claude" mcp list 2>&1)"
        case "$mcpOutput" in
          *"No MCP servers configured"*) ;;
          *) failCheck "unexpected claude mcp list output" ;;
        esac
      '';
    };

    meta = {
      homepage = "https://code.claude.com";
      license = lib.licenses.unfree;
      description = "Agentic coding tool that lives in your terminal, understands your codebase, and helps you code faster";
    };
  };
in
claudeCode.overrideAttrs (
  _old: lib.optionalAttrs stdenv.hostPlatform.isDarwin { __noChroot = true; }
)
