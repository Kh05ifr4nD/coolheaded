{
  lib,
  stdenv,
  autoPatchelfHook,
  installShellFiles,
  makeWrapper,
  packageLib,
}:
packageLib.mkGitHubReleaseBinaryPackage {
  pname = "oh-my-pi";
  owner = "can1357";
  mainProgram = "omp";

  targets = packageLib.npmReleaseTargets;
  asset = { target, version }: "omp-${target}";

  nativeBuildInputs = [
    installShellFiles
    makeWrapper
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];

  dontUnpack = true;

  installPhase = ''
    runHook preInstall

    packageRoot="$out/libexec/oh-my-pi"
    install -Dm755 "$src" "$packageRoot/bin/omp"
    makeWrapper "$packageRoot/bin/omp" "$out/bin/omp" \
      --set PI_SKIP_VERSION_CHECK 1

    runHook postInstall
  '';

  preFixup = lib.optionalString packageLib.canExecute ''
    ompCompletionHome="$TMPDIR/omp-completion-home"
    mkdir -p "$ompCompletionHome"

    postFixupHooks+=(
      "installShellCompletion --cmd omp \
        --bash <(HOME=$ompCompletionHome $out/bin/omp completions bash) \
        --fish <(HOME=$ompCompletionHome $out/bin/omp completions fish) \
        --zsh <(HOME=$ompCompletionHome $out/bin/omp completions zsh)"
    )
  '';

  preVersionCheck = ''
    export HOME="$PWD/versionCheckHome"
    mkdir -p "$HOME"
  '';
  versionCheckKeepEnvironment = [ "HOME" ];

  installCheck.extra = ''
    installCheckHome="$PWD/installCheckHome"
    mkdir -p "$installCheckHome"

    helpOutput="$(HOME="$installCheckHome" "$out/bin/omp" --help 2>&1)"
    case "$helpOutput" in
      *"USAGE"*"$ omp [COMMAND]"*) ;;
      *) failCheck "unexpected omp --help output" ;;
    esac

    completionOutput="$(HOME="$installCheckHome" "$out/bin/omp" completions bash 2>&1)"
    case "$completionOutput" in
      *"bash completion for omp"*) ;;
      *) failCheck "unexpected omp completions bash output" ;;
    esac

    smokeTestOutput="$(HOME="$installCheckHome" "$out/bin/omp" --smoke-test 2>&1)"
    case "$smokeTestOutput" in
      *"smoke-test: ok"*) ;;
      *) failCheck "unexpected omp --smoke-test output" ;;
    esac

    assertFileExists "$out/share/bash-completion/completions/omp.bash"
    assertFileExists "$out/share/fish/vendor_completions.d/omp.fish"
    assertFileExists "$out/share/zsh/site-functions/_omp"
  '';

  meta = {
    license = lib.licenses.mit;
    description = "Coding agent with the IDE wired in";
  };
}
