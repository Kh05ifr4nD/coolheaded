{
  lib,
  stdenv,
  autoPatchelfHook,
  ffmpeg-headless,
  makeWrapper,
  nodejs-slim,
  packageLib,
  zlib,
}:

let
  pname = "yt-dlp";
  targets = {
    aarch64-darwin = "yt-dlp_macos";
    aarch64-linux = "yt-dlp_linux_aarch64";
    x86_64-linux = "yt-dlp_linux";
  };
  runtimePath = lib.makeBinPath [
    ffmpeg-headless
    nodejs-slim
  ];
in
packageLib.mkGitHubReleaseBinaryPackage {
  inherit pname targets;
  owner = "yt-dlp";
  tag = { version, ... }: version;
  asset = { target, ... }: target;
  passthru.updateVersionScheme = "calendar";

  nativeBuildInputs = [
    makeWrapper
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    stdenv.cc.cc.lib
    zlib
  ];

  dontUnpack = true;
  installPhase = ''
    runHook preInstall

    install -Dm755 "$src" "$out/libexec/yt-dlp/bin/yt-dlp"
    makeWrapper "$out/libexec/yt-dlp/bin/yt-dlp" "$out/bin/yt-dlp" \
      --add-flags "--no-js-runtimes --js-runtimes node" \
      --prefix PATH : ${lib.escapeShellArg runtimePath}

    runHook postInstall
  '';

  preVersionCheck = ''
    export HOME="$PWD/versionCheckHome"
    export XDG_CACHE_HOME="$PWD/versionCheckCache"
    export XDG_CONFIG_HOME="$PWD/versionCheckConfig"
    mkdir -p "$HOME" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME"
  '';
  versionCheckKeepEnvironment = [
    "HOME"
    "PATH"
    "XDG_CACHE_HOME"
    "XDG_CONFIG_HOME"
  ];

  installCheck.extra = ''
    installCheckHome="$PWD/installCheckHome"
    installCheckCache="$PWD/installCheckCache"
    installCheckConfig="$PWD/installCheckConfig"
    mkdir -p "$installCheckHome" "$installCheckCache" "$installCheckConfig"

    extractorOutput="$(HOME="$installCheckHome" XDG_CACHE_HOME="$installCheckCache" XDG_CONFIG_HOME="$installCheckConfig" "$out/bin/yt-dlp" --list-extractors)"
    case "$extractorOutput" in
      *"youtube"*) ;;
      *) failCheck "yt-dlp YouTube extractor is unavailable" ;;
    esac

    HOME="$installCheckHome" XDG_CACHE_HOME="$installCheckCache" XDG_CONFIG_HOME="$installCheckConfig" \
      "$out/bin/yt-dlp" --print after_move:filepath --help > /dev/null
  '';

  meta = {
    license = lib.licenses.unlicense;
    description = "Feature-rich command-line audio and video downloader";
  };
}
