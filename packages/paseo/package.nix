{ callPackage, packageLib }:

let
  pin = builtins.fromJSON (builtins.readFile ./pin.json);
  source = packageLib.fetchGitHubTagTarball {
    owner = "getpaseo";
    repo = "paseo";
    tag = "v${pin.version}";
    hash = pin.sourceHash;
  };
  upstreamPackage = callPackage (source + "/nix/package.nix") { npmDepsHash = pin.npmVendorHash; };
in
upstreamPackage.overrideAttrs (oldAttrs: {
  postPatch = (oldAttrs.postPatch or "") + ''
    mv scripts/trace-daemon.mjs scripts/trace-daemon-upstream.mjs
    cp ${./script/runtimeContract.mjs} scripts/runtimeContract.mjs
    cp ${./script/runtimeClosure.mjs} scripts/trace-daemon.mjs
    cp ${./script/runtimeClosure.test.mjs} scripts/runtimeClosure.test.mjs
    cp ${./script/runtimeManifest.mjs} scripts/runtimeManifest.mjs
  '';

  preBuild = (oldAttrs.preBuild or "") + ''
    node --test scripts/runtimeClosure.test.mjs
  '';

  nativeInstallCheckInputs = (oldAttrs.nativeInstallCheckInputs or [ ]) ++ [
    packageLib.versionCheckHook
  ];

  doInstallCheck = packageLib.canExecute;
  versionCheckProgram = "${placeholder "out"}/bin/paseo";
  versionCheckProgramArg = "--version";

  installCheckPhase = packageLib.mkInstallCheckPhase {
    executable = "$out/bin/paseo";
    expectedExecutables = [
      "paseo"
      "paseo-server"
    ];
    helpContains = "Paseo CLI - control your AI coding agents";
    extra = ''
      daemonHelpOutput="$("$out/bin/paseo" daemon --help 2>&1)"
      case "$daemonHelpOutput" in
        *"Manage the Paseo daemon"*) ;;
        *) failCheck "unexpected paseo daemon --help output" ;;
      esac

      assertFileExists "$out/lib/paseo/package.json"
      assertFileExists "$out/lib/paseo/packages/cli/dist/index.js"
      assertFileExists "$out/lib/paseo/packages/server/dist/server/server/daemon-worker.js"
      assertFileExists "$out/lib/paseo/packages/server/dist/scripts/supervisor-entrypoint.js"
    '';
  };

  meta = oldAttrs.meta // {
    changelog = "https://github.com/getpaseo/paseo/releases/tag/v${pin.version}";
    description = "Orchestrate multiple coding agents from desktop and mobile";
  };
})
