{
  lib,
  stdenv,
  fetchFromGitHub,
  ffmpeg-headless,
  makeWrapper,
  nodejs_24,
  packageLib,
  python313Packages,
  symlinkJoin,
  coolheaded,
}:

let
  pname = "agent-reach";
  pin = builtins.fromJSON (builtins.readFile ./pin.json);
  canExecute = stdenv.buildPlatform.canExecute stdenv.hostPlatform;
  runtimeTools = [
    coolheaded.deno
    coolheaded.gh
    coolheaded.mcporter
    coolheaded.openCli
    coolheaded.ytDlp
    ffmpeg-headless
    nodejs_24
  ];

  application = python313Packages.buildPythonApplication {
    inherit pname;
    inherit (pin) version;

    src = fetchFromGitHub {
      owner = "Panniantong";
      repo = "Agent-Reach";
      tag = "v${pin.version}";
      hash = pin.sourceHash;
    };

    pyproject = true;
    strictDeps = true;
    __structuredAttrs = true;

    patches = [ ./patch/nixManagedRuntime.patch ];

    build-system = [ python313Packages.hatchling ];
    dependencies = with python313Packages; [
      feedparser
      loguru
      python-dotenv
      pyyaml
      requests
      rich
    ];

    makeWrapperArgs = [
      "--set"
      "AGENT_REACH_NIX_MANAGED"
      "1"
      "--prefix"
      "PATH"
      ":"
      (lib.makeBinPath runtimeTools)
    ];

    doCheck = true;
    nativeCheckInputs = [ python313Packages.pytestCheckHook ];
    pytestFlags = [ "tests" ];

    doInstallCheck = canExecute;
    installCheckPhase = ''
      runHook preInstallCheck

      . ${../../lib/package.sh}

      installCheckHome="$PWD/installCheckHome"
      mkdir -p "$installCheckHome"

      assertExecutableSet "$out/bin" agent-reach
      HOME="$installCheckHome" "$out/bin/agent-reach" version | grep -q "Agent Reach v${pin.version}"
      HOME="$installCheckHome" "$out/bin/agent-reach" --help > /dev/null
      HOME="$installCheckHome" "$out/bin/agent-reach" install --dry-run --env server > install-output
      grep -q "DRY RUN" install-output
      test ! -e "$installCheckHome/.agent-reach" \
        || failCheck "dry-run created mutable Agent-Reach state"

      runHook postInstallCheck
    '';

    meta = {
      homepage = "https://github.com/Panniantong/Agent-Reach";
      license = lib.licenses.mit;
      description = "Installer and diagnostics for direct agent access to internet platform tools";
      mainProgram = pname;
      platforms = packageLib.supportedSystems;
      sourceProvenance = with lib.sourceTypes; [ fromSource ];
    };
  };
in
symlinkJoin {
  name = "${pname}-${pin.version}";
  paths = [ application ] ++ runtimeTools;
  nativeBuildInputs = [ makeWrapper ];

  postBuild = lib.optionalString canExecute ''
    . ${../../lib/package.sh}

    assertExecutableSet "$out/bin" \
      agent-reach corepack deno dx ffmpeg ffprobe gh mcporter node npm npx opencli yt-dlp
    "$out/bin/agent-reach" version > /dev/null
    "$out/bin/gh" --version > /dev/null
    "$out/bin/mcporter" --version > /dev/null
    "$out/bin/opencli" --version > /dev/null
    "$out/bin/yt-dlp" --version > /dev/null
  '';

  passthru = { inherit application; };

  meta = application.meta // {
    sourceProvenance = with lib.sourceTypes; [
      fromSource
      binaryNativeCode
    ];
  };
}
