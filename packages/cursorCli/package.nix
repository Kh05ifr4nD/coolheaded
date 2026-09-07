{
  bash,
  coreutils,
  curl,
  gnutar,
  lib,
  stdenv,
  writeShellApplication,
}:

let
  pin = builtins.fromJSON (builtins.readFile ./pin.json);
  targets = {
    aarch64-darwin = "darwin/arm64";
    aarch64-linux = "linux/arm64";
    x86_64-linux = "linux/x64";
  };
  target = targets.${stdenv.hostPlatform.system};

  launcher = writeShellApplication {
    name = "cursor-agent";
    runtimeInputs = [
      bash
      coreutils
      curl
      gnutar
    ];
    text = ''
      set -eu

      versionsRoot="$HOME/.local/share/cursor-agent/versions"
      versionDirectory="$versionsRoot/${pin.binaryVersion}"
      installedLauncher="$versionDirectory/cursor-agent"

      if [ ! -x "$installedLauncher" ]; then
        rm -rf "$versionDirectory"
        mkdir -p "$versionsRoot"
        temporaryDirectory="$(mktemp -d "$versionsRoot/.tmp-${pin.binaryVersion}.XXXXXX")"
        trap 'rm -rf "$temporaryDirectory"' EXIT

        curl --fail --silent --show-error --location \
          "https://downloads.cursor.com/lab/${pin.binaryVersion}/${target}/agent-cli-package.tar.gz" \
          | tar --extract --gzip --strip-components=1 --directory "$temporaryDirectory" --file -
        mv "$temporaryDirectory" "$versionDirectory"
        trap - EXIT
      fi

      if [ ! -x "$installedLauncher" ]; then
        printf '%s\n' \
          "Cursor CLI package did not create $installedLauncher" >&2
        exit 1
      fi

      exec "$installedLauncher" "$@"
    '';
  };
in
stdenv.mkDerivation {
  pname = "cursor-cli";
  inherit (pin) version;

  dontUnpack = true;
  dontBuild = true;

  passthru.updateVersionScheme = "calendar";

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin"
    ln -s ${launcher}/bin/cursor-agent "$out/bin/cursor-agent"

    runHook postInstall
  '';

  meta = {
    homepage = "https://cursor.com/cli";
    license = lib.licenses.mit;
    mainProgram = "cursor-agent";
    platforms = builtins.attrNames targets;
    description = "Installer wrapper for Cursor CLI, an AI terminal agent for writing, reviewing, and modifying code";
  };
}
