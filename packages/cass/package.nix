{
  lib,
  stdenv,
  autoPatchelfHook,
  installShellFiles,
  packageLib,
}:
let
  pin = builtins.fromJSON (builtins.readFile ./pin.json);
in
packageLib.mkGitHubReleaseBinaryPackage {
  pname = "cass";
  owner = "Dicklesworthstone";
  repo = "coding_agent_session_search";

  targets = {
    aarch64-darwin = "cass-darwin-arm64.tar.gz";
    aarch64-linux = "cass-linux-arm64.tar.gz";
    x86_64-linux = "cass-linux-amd64.tar.gz";
  };
  asset = { target, ... }: target;

  nativeBuildInputs = [
    installShellFiles
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src"
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 cass "$out/bin/cass"
    runHook postInstall
  '';

  preFixup = lib.optionalString packageLib.canExecute ''
    postFixupHooks+=(
      "installShellCompletion --cmd cass \
        --bash <(\"$out/bin/cass\" completions bash) \
        --fish <(\"$out/bin/cass\" completions fish) \
        --zsh <(\"$out/bin/cass\" completions zsh)"
      "installManPage --name cass.1 <(\"$out/bin/cass\" man)"
    )
  '';

  installCheck = {
    helpContains = "Usage: cass";
    extra = ''
      selfTestOutput="$("$out/bin/cass" selftest 2>&1)"
      case "$selfTestOutput" in
        *"self-test passed"*) ;;
        *) failCheck "unexpected cass selftest output" ;;
      esac
      assertFileExists "$out/share/bash-completion/completions/cass.bash"
      assertFileExists "$out/share/fish/vendor_completions.d/cass.fish"
      assertFileExists "$out/share/zsh/site-functions/_cass"
      assertFileExists "$out/share/man/man1/cass.1"
    '';
  };

  meta = {
    license = {
      deprecated = false;
      free = false;
      fullName = "MIT License with OpenAI/Anthropic Rider";
      licenseType = "simple";
      redistributable = true;
      shortName = "mit-openai-anthropic-rider";
      spdxId = "LicenseRef-MIT-OpenAI-Anthropic-Rider";
      url = "https://github.com/Dicklesworthstone/coding_agent_session_search/blob/v${pin.version}/LICENSE";
    };
    description = "Unified TUI search over coding agent histories";
  };
}
