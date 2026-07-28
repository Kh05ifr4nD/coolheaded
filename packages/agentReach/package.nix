{
  lib,
  stdenv,
  fetchFromGitHub,
  ffmpeg-headless,
  nodejs-slim,
  packageLib,
  python313Packages,
  coolheaded,
}:

let
  pname = "agent-reach";
  pin = builtins.fromJSON (builtins.readFile ./pin.json);
  canExecute = stdenv.buildPlatform.canExecute stdenv.hostPlatform;
  runtimeTools = [
    coolheaded.gh
    coolheaded.mcporter
    coolheaded.openCli
    coolheaded.ytDlp
    ffmpeg-headless
    nodejs-slim
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

    postPatch = ''
      grep -Fq "System dependencies are provided by the Nix package." agent_reach/cli.py
      grep -Fq 'AGENT_REACH_NIX_MANAGED") != "1"' agent_reach/channels/youtube.py
    '';

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

    postFixup = ''
      mkdir -p "$out/libexec/agent-reach"
      mv "$out/bin/.agent-reach-wrapped" "$out/libexec/agent-reach/agent-reach"
      substituteInPlace "$out/bin/agent-reach" \
        --replace-fail "$out/bin/.agent-reach-wrapped" "$out/libexec/agent-reach/agent-reach"
    '';

    doInstallCheck = canExecute;
    nativeInstallCheckInputs = [ python313Packages.pytest ];
    installCheckPhase = ''
      runHook preInstallCheck

      . ${../../lib/package.sh}

      pytestHome="$PWD/pytestHome"
      mkdir -p "$pytestHome"
      HOME="$pytestHome" pytest -q tests

      dryRunHome="$PWD/dryRunHome"
      safeHome="$PWD/safeHome"
      normalHome="$PWD/normalHome"
      mkdir -p "$dryRunHome" "$safeHome" "$normalHome"

      assertExecutableSet "$out/bin" agent-reach
      test ! -e "$out/bin/.agent-reach-wrapped" \
        || failCheck "private Python launcher leaked into the public bin directory"
      HOME="$dryRunHome" "$out/bin/agent-reach" version | grep -q "Agent Reach v${pin.version}"
      HOME="$dryRunHome" "$out/bin/agent-reach" --help > /dev/null
      HOME="$dryRunHome" "$out/bin/agent-reach" install --dry-run --env server > dry-run-output
      grep -q "DRY RUN" dry-run-output
      test ! -e "$dryRunHome/.agent-reach" \
        || failCheck "dry-run created mutable Agent-Reach state"

      HOME="$safeHome" "$out/bin/agent-reach" install --safe --env server --channels youtube > safe-output
      test ! -e "$safeHome/.agent-reach" \
        || failCheck "safe mode created mutable Agent-Reach state"
      test ! -e "$safeHome/.agents" \
        || failCheck "safe mode installed an agent skill"

      HOME="$normalHome" "$out/bin/agent-reach" install --env server --channels youtube > normal-output
      grep -q "System dependencies are provided by the Nix package" normal-output
      assertDirectoryExists "$normalHome/.agent-reach/tools"
      assertFileExists "$normalHome/.agents/skills/agent-reach/SKILL.md"

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
application
