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
    makeWrapper "$packageRoot/bin/grok" "$packageRoot/bin/agent-launcher" \
      --argv0 agent \
      --add-flags --no-auto-update
  ''
  + lib.optionalString stdenv.hostPlatform.isLinux ''
    install -d "$out/bin"
    for name in grok agent; do
      {
        printf '#!%s\n' '${stdenv.shell}'
        printf 'exec %s %s -- %s/libexec/grok/bin/%s-launcher "$@"\n' \
          '${bubblewrap}/bin/bwrap' '${bwrapFlags}' "$out" "$name"
      } > "$out/bin/$name"
      chmod +x "$out/bin/$name"
    done
  ''
  + lib.optionalString (!stdenv.hostPlatform.isLinux) ''
    install -d "$out/bin"
    ln -s "$packageRoot/bin/grok-launcher" "$out/bin/grok"
    ln -s "$packageRoot/bin/agent-launcher" "$out/bin/agent"
  ''
  + ''
    runHook postInstall
  '';

  expectedExecutables = [
    "agent"
    "grok"
  ];

  installCheck = {
    helpContains = "Usage:";
    extra =
      lib.optionalString stdenv.hostPlatform.isLinux ''
        test ! -L "$out/bin/grok" || failCheck "expected wrapped grok launcher"
        test ! -L "$out/bin/agent" || failCheck "expected wrapped agent launcher"
      ''
      + ''
        grep -F -- '--no-auto-update' "$out/libexec/grok/bin/grok-launcher" > /dev/null \
          || failCheck "grok wrapper must disable upstream update checks"
        grep -F -- '--no-auto-update' "$out/libexec/grok/bin/agent-launcher" > /dev/null \
          || failCheck "agent wrapper must disable upstream update checks"
      '';
  };

  meta = {
    homepage = "https://x.ai/cli";
    license = lib.licenses.unfree;
    description = "Grok Build, xAI's agentic coding tool";
  };
}
