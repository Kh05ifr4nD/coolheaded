{
  lib,
  stdenv,
  bashInteractive,
  bubblewrap,
  makeWrapper,
  packageLib,
  wrapBuddy,
  zsh,
}:
let
  pname = "grok";

  releaseTargets = packageLib.mkTargets [
    "macos-aarch64"
    "linux-aarch64"
    "linux-x86_64"
  ];

  bwrapFlags = lib.concatStringsSep " " [
    "--dev-bind / /"
    "--tmpfs /bin"
    "--symlink ${bashInteractive}/bin/bash /bin/bash"
    "--symlink ${zsh}/bin/zsh /bin/zsh"
    "--symlink ${bashInteractive}/bin/sh /bin/sh"
  ];
in
packageLib.mkReleaseBinaryPackage {
  inherit pname;

  targets = releaseTargets;
  asset = { target, version }: "grok-${version}-${target}";
  url =
    { releaseAsset, ... }:
    "https://storage.googleapis.com/grok-build-public-artifacts/cli/${releaseAsset}";
  dontUnpack = true;

  nativeBuildInputs = [ makeWrapper ] ++ lib.optionals stdenv.hostPlatform.isLinux [ wrapBuddy ];

  installPhase = ''
    runHook preInstall

    packageRoot="$out/libexec/grok"
    install -Dm755 "$src" "$packageRoot/bin/grok"
    makeWrapper "$packageRoot/bin/grok" "$packageRoot/bin/grok-launcher" \
      --argv0 grok \
      --add-flags --no-auto-update
  ''
  + lib.optionalString stdenv.hostPlatform.isLinux ''
    install -d "$out/bin"
    {
      printf '#!%s\n' '${stdenv.shell}'
      printf 'exec %s %s -- %s/libexec/grok/bin/grok-launcher "$@"\n' \
        '${bubblewrap}/bin/bwrap' '${bwrapFlags}' "$out"
    } > "$out/bin/grok"
    chmod +x "$out/bin/grok"
  ''
  + lib.optionalString (!stdenv.hostPlatform.isLinux) ''
    install -d "$out/bin"
    ln -s "$packageRoot/bin/grok-launcher" "$out/bin/grok"
  ''
  + ''
    runHook postInstall
  '';

  expectedExecutables = [ "grok" ];

  versionCheckProgram = "${placeholder "out"}/libexec/grok/bin/grok-launcher";

  installCheck = {
    executable = "$out/libexec/grok/bin/grok-launcher";
    helpContains = "Usage:";
    extra =
      lib.optionalString stdenv.hostPlatform.isLinux ''
        test ! -L "$out/bin/grok" || failCheck "expected wrapped grok launcher"
      ''
      + ''
        grep -F -- '--no-auto-update' "$out/libexec/grok/bin/grok-launcher" > /dev/null \
          || failCheck "grok wrapper must disable upstream update checks"
      '';
  };

  meta = {
    homepage = "https://x.ai/cli";
    license = lib.licenses.unfree;
    description = "Grok Build, xAI's agentic coding tool";
  };
}
