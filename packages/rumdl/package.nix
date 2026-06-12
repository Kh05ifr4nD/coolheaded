{
  lib,
  stdenv,
  autoPatchelfHook,
  installShellFiles,
  packageLib,
}:
packageLib.mkGitHubReleaseBinaryPackage {
  pname = "rumdl";
  owner = "rvben";

  targets = packageLib.rustTargetTriples;
  asset = { version, target }: "rumdl-v${version}-${target}.tar.gz";

  nativeBuildInputs = [
    installShellFiles
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src"
    runHook postUnpack
  '';

  preFixup = lib.optionalString packageLib.canExecute ''
    postFixupHooks+=(
      "installShellCompletion --cmd rumdl \
        --bash <($out/bin/rumdl completions bash) \
        --fish <($out/bin/rumdl completions fish) \
        --zsh <($out/bin/rumdl completions zsh)"
    )
  '';

  installCheck = {
    helpContains = "Usage: rumdl";
    extra = ''
      checkTestDir="$(mktemp -d)"
      printf '# heading\n' > "$checkTestDir/input.md"
      "$out/bin/rumdl" check "$checkTestDir/input.md"
      "$out/bin/rumdl" fmt --check "$checkTestDir/input.md"

      assertFileExists "$out/share/bash-completion/completions/rumdl.bash"
      assertFileExists "$out/share/fish/vendor_completions.d/rumdl.fish"
      assertFileExists "$out/share/zsh/site-functions/_rumdl"
    '';
  };

  meta = {
    homepage = "https://rumdl.dev";
    license = lib.licenses.mit;
    description = "Fast Markdown linter and formatter written in Rust";
  };
}
