{
  lib,
  gzip,
  installShellFiles,
  packageLib,
}:
packageLib.mkGitHubReleaseBinaryPackage {
  pname = "entire";
  owner = "entireio";
  repo = "cli";
  versionCheckProgramArg = "version";

  targets = packageLib.mkTargets [
    "entire_darwin_arm64.tar.gz"
    "entire_linux_arm64.tar.gz"
    "entire_linux_amd64.tar.gz"
  ];
  asset = { target, version }: target;

  nativeBuildInputs = [
    gzip
    installShellFiles
  ];

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src"
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 entire "$out/bin/entire"
    install -Dm755 git-remote-entire "$out/bin/git-remote-entire"
    installShellCompletion \
      --cmd entire \
      --bash completions/entire.bash \
      --fish completions/entire.fish \
      --zsh completions/entire.zsh
    install -Dm644 LICENSE "$out/share/licenses/entire/LICENSE"
    install -Dm644 README.md "$out/share/doc/entire/README.md"

    runHook postInstall
  '';

  installCheck = {
    helpFlag = "help";
    helpContains = "Usage:";
    extra = ''
      "$out/bin/git-remote-entire" --version > /dev/null
    '';
  };

  meta = {
    license = lib.licenses.mit;
    description = "Hooks into your Git workflow to capture AI agent sessions as you work";
  };
}
