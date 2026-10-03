{
  lib,
  stdenv,
  autoPatchelfHook,
  installShellFiles,
  makeWrapper,
  ncurses,
  packageLib,
  ripgrep,
  bubblewrap,
  withRipgrep ? true,
  withBubblewrap ? stdenv.hostPlatform.isLinux,
}:
let
  pname = "codex";
  npmTargets = packageLib.npmReleaseTargets;
  vendorTargets = {
    aarch64-darwin = "aarch64-apple-darwin";
    aarch64-linux = "aarch64-unknown-linux-musl";
    x86_64-linux = "x86_64-unknown-linux-musl";
  };
  vendorTarget = packageLib.releaseTarget pname vendorTargets;

  wrapperInputs = (
    lib.optionals withRipgrep [ ripgrep ]
    ++ lib.optionals (withBubblewrap && stdenv.hostPlatform.isLinux) [ bubblewrap ]
  );
  wrapperPath = lib.makeBinPath wrapperInputs;
  wrapperNeeded = wrapperInputs != [ ];
  wrapperArgs = lib.optionals wrapperNeeded [
    "--prefix"
    "PATH"
    ":"
    wrapperPath
  ];
in
packageLib.mkNpmTarballPackage {
  inherit pname;
  packageName = "@openai/codex";
  targets = npmTargets;
  asset = { version, target }: "codex-${version}-${target}.tgz";
  changelog = { version, ... }: "https://github.com/openai/codex/releases/tag/rust-v${version}";

  nativeBuildInputs = [
    installShellFiles
    makeWrapper
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    ncurses
    stdenv.cc.cc.lib
  ];

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src" --strip-components=1
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall

    packageRoot="$out/libexec/codex"
    mkdir -p "$packageRoot" "$out/bin"
    # Daemon installation validates and copies the complete upstream package.
    cp -a "vendor/${vendorTarget}/." "$packageRoot/"

    ${
      if wrapperNeeded then
        ''
          makeWrapper "$packageRoot/bin/codex" "$out/bin/codex" ${lib.escapeShellArgs wrapperArgs}
        ''
      else
        ''
          ln -s "$packageRoot/bin/codex" "$out/bin/codex"
        ''
    }

    runHook postInstall
  '';

  preFixup =
    lib.optionalString stdenv.hostPlatform.isLinux ''
      # The daemon relocates this tree; keep its private library paths relative.
      autoPatchelfFlags+=(--relativize-rpath)
    ''
    + lib.optionalString packageLib.canExecute ''
      installCodexShellCompletions() {
        completionHome="$PWD/completionHome"
        completionCodexHome="$PWD/completionCodexHome"
        completionTmp="$PWD/completionTmp"
        mkdir -p "$completionHome" "$completionCodexHome" "$completionTmp"

        export HOME="$completionHome"
        export CODEX_HOME="$completionCodexHome"
        export TMPDIR="$completionTmp"
        installShellCompletion --cmd codex \
          --bash <($out/bin/codex completion bash) \
          --fish <($out/bin/codex completion fish) \
          --zsh <($out/bin/codex completion zsh)
      }
      postFixupHooks+=(installCodexShellCompletions)
    '';

  preVersionCheck = ''
    export HOME="$PWD/versionCheckHome"
    export CODEX_HOME="$PWD/versionCheckCodexHome"
    export TMPDIR="$PWD/versionCheckTmp"
    mkdir -p "$HOME" "$CODEX_HOME" "$TMPDIR"
  '';
  versionCheckKeepEnvironment = [
    "HOME"
    "CODEX_HOME"
    "TMPDIR"
  ];

  installCheck.extra = ''
    assertFileExists "$out/share/bash-completion/completions/codex.bash"
    assertFileExists "$out/share/fish/vendor_completions.d/codex.fish"
    assertFileExists "$out/share/zsh/site-functions/_codex"
    assertFileExists "$out/libexec/codex/bin/codex-code-mode-host"

    "$out/libexec/codex/codex-resources/zsh/bin/zsh" --version
    "$out/libexec/codex/bin/codex-code-mode-host" --help > /dev/null
    "$out/libexec/codex/codex-path/rg" --version
    ${lib.optionalString stdenv.hostPlatform.isLinux ''
      "$out/libexec/codex/codex-resources/bwrap" --version
    ''}
    ${
      if wrapperNeeded then
        ''
          test ! -L "$out/bin/codex" || failCheck "expected wrapped codex launcher"
        ''
      else
        ''
          test -L "$out/bin/codex" || failCheck "expected codex launcher symlink"
          case "$(readlink "$out/bin/codex")" in
            "$out/libexec/codex/bin/codex") ;;
            "../libexec/codex/bin/codex") ;;
            *) failCheck "unexpected codex launcher symlink target" ;;
          esac
        ''
    }
  '';

  meta = {
    homepage = "https://github.com/openai/codex";
    license = lib.licenses.asl20;
    description = "Lightweight coding agent that runs in your terminal";
  };
}
