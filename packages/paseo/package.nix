{
  lib,
  stdenv,
  autoPatchelfHook,
  buildNpmPackage,
  fetchFromGitHub,
  libuv,
  makeWrapper,
  nodejs_22,
  packageLib,
  python3,
}:

let
  pin = builtins.fromJSON (builtins.readFile ./pin.json);
in
buildNpmPackage {
  pname = "paseo";
  inherit (pin) version;

  src = fetchFromGitHub {
    owner = "getpaseo";
    repo = "paseo";
    tag = "v${pin.version}";
    hash = pin.sourceHash;
  };

  nodejs = nodejs_22;
  npmDepsHash = pin.npmVendorHash;
  npmRebuildFlags = [ "--ignore-scripts" ];

  nativeBuildInputs = [
    python3
    makeWrapper
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    libuv
    stdenv.cc.cc.lib
  ];

  dontNpmBuild = true;

  postPatch = ''
    mv scripts/trace-daemon.mjs scripts/trace-daemon-upstream.mjs
    cp ${./script/runtimeContract.mjs} scripts/runtimeContract.mjs
    cp ${./script/runtimeClosure.mjs} scripts/trace-daemon.mjs
    cp ${./script/runtimeClosure.test.mjs} scripts/runtimeClosure.test.mjs
    cp ${./script/runtimeManifest.mjs} scripts/runtimeManifest.mjs
  '';

  preBuild = ''
    node --test scripts/runtimeClosure.test.mjs
  '';

  buildPhase = ''
    runHook preBuild
    npm rebuild node-pty
    npm run build:server
    npm run build:daemon-web-ui
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/paseo
    node scripts/trace-daemon.mjs > daemon-files.txt

    while IFS= read -r path; do
      [ -z "$path" ] && continue
      mkdir -p "$out/lib/paseo/$(dirname "$path")"
      cp -a "$path" "$out/lib/paseo/$path"
    done < daemon-files.txt

    cp package.json $out/lib/paseo/
    cp -r packages/server/dist/server/web-ui $out/lib/paseo/packages/server/dist/server/

    mkdir -p $out/bin
    makeWrapper ${nodejs_22}/bin/node $out/bin/paseo-server \
      --add-flags "$out/lib/paseo/packages/server/dist/scripts/supervisor-entrypoint.js" \
      --set PASEO_NODE_ENV production

    makeWrapper ${nodejs_22}/bin/node $out/bin/paseo \
      --add-flags "$out/lib/paseo/packages/cli/dist/index.js" \
      --set NODE_PATH "$out/lib/paseo/node_modules"

    runHook postInstall
  '';

  nativeInstallCheckInputs = [ packageLib.versionCheckHook ];
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
      assertFileExists "$out/lib/paseo/packages/server/dist/server/terminal/terminal-worker-process.js"
      ptyBinary="$(find "$out/lib/paseo/packages/server/node_modules/node-pty/prebuilds" -type f -name pty.node -print -quit)"
      [ -n "$ptyBinary" ] || failCheck "missing node-pty native addon"
    '';
  };

  meta = {
    homepage = "https://github.com/getpaseo/paseo";
    license = lib.licenses.agpl3Plus;
    changelog = "https://github.com/getpaseo/paseo/releases/tag/v${pin.version}";
    description = "Orchestrate multiple coding agents from desktop and mobile";
    mainProgram = "paseo";
    platforms = packageLib.supportedSystems;
    sourceProvenance = with lib.sourceTypes; [ fromSource ];
  };
}
