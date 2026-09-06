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

      installedLauncher="$HOME/.local/bin/cursor-agent"

      if [ ! -x "$installedLauncher" ]; then
        curl --fail --silent --show-error --location https://cursor.com/install | bash
      fi

      if [ ! -x "$installedLauncher" ]; then
        printf '%s\n' \
          "Cursor CLI installer completed without creating $installedLauncher" >&2
        exit 1
      fi

      exec "$installedLauncher" "$@"
    '';
  };
in
stdenv.mkDerivation {
  pname = "cursor-cli";
  version = "0.0.0";

  dontUnpack = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin"
    ln -s ${launcher}/bin/cursor-agent "$out/bin/cursor-agent"
    ln -s cursor-agent "$out/bin/agent"

    runHook postInstall
  '';

  meta = {
    homepage = "https://cursor.com/cli";
    license = lib.licenses.mit;
    mainProgram = "cursor-agent";
    platforms = lib.platforms.unix;
    description = "Installer wrapper for Cursor CLI, an AI terminal agent for writing, reviewing, and modifying code";
  };
}
