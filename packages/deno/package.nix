{
  lib,
  stdenv,
  autoPatchelfHook,
  installShellFiles,
  makeWrapper,
  packageLib,
  unzip,
}:
let
  pname = "deno";
  targets = packageLib.rustTargetTriples;
in
packageLib.mkReleaseBinaryPackage {
  inherit pname;
  inherit targets;
  asset = { target, ... }: "deno-${target}.zip";
  url = { version, releaseAsset, ... }: "https://dl.deno.land/release/v${version}/${releaseAsset}";
  changelog = { version, ... }: "https://github.com/denoland/deno/releases/tag/v${version}";

  nativeBuildInputs = [
    installShellFiles
    makeWrapper
    unzip
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];

  unpackPhase = ''
    runHook preUnpack
    unzip -q "$src"
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall

    packageRoot="$out/libexec/deno"
    install -Dm755 deno "$packageRoot/bin/deno"
    makeWrapper "$packageRoot/bin/deno" "$out/bin/deno" --set-default DENO_NO_UPDATE_CHECK 1
    makeWrapper "$packageRoot/bin/deno" "$out/bin/dx" --set-default DENO_NO_UPDATE_CHECK 1 --add-flags "x"

    runHook postInstall
  '';

  preFixup = lib.optionalString packageLib.canExecute ''
    postFixupHooks+=(
      "installShellCompletion --cmd deno \
        --bash <($out/bin/deno completions bash) \
        --fish <($out/bin/deno completions fish) \
        --zsh <($out/bin/deno completions zsh)"
    )
  '';

  installCheck = {
    helpContains = "Usage: deno";
    extra = ''
      dxHelpOutput="$("$out/bin/dx" --help 2>&1)"
      case "$dxHelpOutput" in
        *"Usage: deno"*) ;;
        *) failCheck "unexpected dx --help output" ;;
      esac

      assertFileExists "$out/share/bash-completion/completions/deno.bash"
      assertFileExists "$out/share/fish/vendor_completions.d/deno.fish"
      assertFileExists "$out/share/zsh/site-functions/_deno"
    '';
  };

  passthru.updateAllowedFiles = [ "flake/gitHooks.nix" ];

  meta = {
    homepage = "https://deno.com/";
    license = lib.licenses.mit;
    description = "Modern runtime for JavaScript and TypeScript";
  };
}
