{
  lib,
  stdenv,
  installShellFiles,
  packageLib,
  unzip,
}:
packageLib.mkGitHubReleaseBinaryPackage {
  pname = "llp";
  owner = "run-llama";
  repo = "llama-parse-cli";

  targets = {
    aarch64-darwin = "macos_arm64.zip";
    aarch64-linux = "linux_arm64.tar.gz";
    x86_64-linux = "linux_amd64.tar.gz";
  };
  asset = { target, version }: "llp_${version}_${target}";

  nativeBuildInputs = [ installShellFiles ] ++ lib.optionals stdenv.hostPlatform.isDarwin [ unzip ];

  unpackPhase = ''
    runHook preUnpack
    ${
      if stdenv.hostPlatform.isDarwin then
        ''
          unzip -q "$src"
        ''
      else
        ''
          tar -xzf "$src"
        ''
    }
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 llp "$out/bin/llp"
    installShellCompletion \
      --cmd llp \
      --bash completions/llp.bash \
      --fish completions/llp.fish \
      --zsh completions/llp.zsh
    installManPage man/man1/llp.1.gz

    runHook postInstall
  '';

  installCheck = {
    helpContains = "CLI for the llama-cloud API";
    extra = ''
      "$out/bin/llp" parsing --help > /dev/null
      assertFileExists "$out/share/bash-completion/completions/llp.bash"
      assertFileExists "$out/share/fish/vendor_completions.d/llp.fish"
      assertFileExists "$out/share/zsh/site-functions/_llp"
      assertFileExists "$out/share/man/man1/llp.1.gz"
    '';
  };

  meta = {
    license = lib.licenses.mit;
    description = "CLI for the Llama Cloud REST API";
  };
}
