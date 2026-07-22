{ lib, packageLib }:
packageLib.mkReleaseBinaryPackage {
  pname = "grok";

  targets = packageLib.mkTargets [
    "macos-aarch64"
    "linux-aarch64"
    "linux-x86_64"
  ];
  asset = { version, target }: "grok-${version}-${target}";
  url = { releaseAsset, ... }: "https://x.ai/cli/${releaseAsset}";
  changelog = _: "https://x.ai/build/changelog";
  dontUnpack = true;

  installPhase = ''
    runHook preInstall
    install -Dm755 "$src" "$out/bin/grok"
    runHook postInstall
  '';

  installCheck = {
    expectedExecutables = [ "grok" ];
    extra = ''
      test ! -e "$out/bin/agent" || failCheck "unexpected agent launcher"
      completionOutput="$("$out/bin/grok" completions bash)"
      test -n "$completionOutput" || failCheck "expected non-empty Bash completion output"
    '';
  };

  meta = {
    homepage = "https://github.com/xai-org/grok-build";
    license = lib.licenses.asl20;
    description = "Terminal-based AI coding assistant";
  };
}
