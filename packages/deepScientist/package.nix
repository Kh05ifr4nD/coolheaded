{
  lib,
  stdenvNoCC,
  buildNpmPackage,
  callPackage,
  fetchFromGitHub,
  fetchNpmDeps,
  fetchurl,
  bash,
  claude-code,
  coolheaded,
  git,
  jq,
  makeWrapper,
  nodejs,
  opencode,
  packageLib,
  python3,
  uv,
  pyprojectBuildSystems,
  pyprojectNix,
  uv2nix,
  withClaudeCode ? true,
  withCodex ? true,
  withOpenCode ? true,
}:
let
  pname = "deepscientist";

  pin = builtins.fromJSON (builtins.readFile ./pin.json);

  inherit (stdenvNoCC.hostPlatform) system;
  packageHash =
    pin.platformPackageHashes.${system}
      or (throw "Missing ${pname} ${pin.version} package hash for ${system}");

  packageSrc = fetchurl {
    url = packageLib.npmTarballUrl {
      packageName = "@researai/deepscientist";
      version = pin.version;
    };
    hash = packageHash;
  };

  upstreamSourceSrc = fetchFromGitHub {
    owner = "ResearAI";
    repo = "DeepScientist";
    tag = "v${pin.version}";
    hash = pin.sourceHash;
  };
  upstreamWorkspaceSrc = packageLib.fetchGitHubTagTarball {
    owner = "ResearAI";
    repo = "DeepScientist";
    tag = "v${pin.version}";
    hash = pin.sourceHash;
  };
  upstreamPyproject = builtins.fromTOML (builtins.readFile "${upstreamWorkspaceSrc}/pyproject.toml");

  syncNodePackageLock = packageLib.syncPackageJsonFromPackageLock {
    packageLock = ./package-lock.json;
  };

  nodeModulesNpmDeps = fetchNpmDeps {
    name = "${pname}-node-modules-${pin.version}-npm-deps";
    src = upstreamSourceSrc;
    hash = pin.npmVendorHash;
    nativeBuildInputs = [ jq ];
    postPatch = syncNodePackageLock;
  };

  nodeModules = buildNpmPackage {
    pname = "${pname}-node-modules";
    inherit (pin) version;
    src = upstreamSourceSrc;

    npmDeps = nodeModulesNpmDeps;

    strictDeps = true;
    __structuredAttrs = true;

    nativeBuildInputs = [ jq ];

    dontNpmBuild = true;

    postPatch = syncNodePackageLock;

    installPhase = ''
      runHook preInstall

      mkdir -p "$out"
      cp -R node_modules "$out/"

      runHook postInstall
    '';
  };

  pyproject = upstreamPyproject;
  workspace = uv2nix.lib.workspace.loadWorkspace {
    inherit pyproject;
    workspaceRoot = upstreamWorkspaceSrc;
  };
  overlay = workspace.mkPyprojectOverlay { sourcePreference = "wheel"; };
  pythonSet = (callPackage pyprojectNix.build.packages { python = python3; }).overrideScope (
    lib.composeManyExtensions [
      pyprojectBuildSystems.overlays.wheel
      overlay
      (_final: prev: {
        deepscientist = prev.deepscientist.overrideAttrs (oldAttrs: {
          patches = (oldAttrs.patches or [ ]) ++ [ ./patch/normalizeUvLockRootVersion.patch ];
        });
      })
    ]
  );
  pythonEnvironment = pythonSet.mkVirtualEnv "${pname}-env" { deepscientist = [ "acp" ]; };
  runtimePython = "${pythonEnvironment}/bin/python";

  wrapperInputs = [
    bash
    git
    nodejs
    pythonEnvironment
    uv
  ]
  ++ lib.optionals withClaudeCode [ claude-code ]
  ++ lib.optionals withCodex [ coolheaded.codex ]
  ++ lib.optionals withOpenCode [ opencode ];
  wrapperPath = lib.makeBinPath wrapperInputs;
  claudePath = lib.makeBinPath [ claude-code ];
  codexPath = lib.makeBinPath [ coolheaded.codex ];
  opencodePath = lib.makeBinPath [ opencode ];
  launcherNames = [
    "ds"
    "ds-cli"
    "resear"
    "research"
  ];
in
stdenvNoCC.mkDerivation {
  inherit pname;
  inherit (pin) version;
  src = packageSrc;

  strictDeps = true;
  __structuredAttrs = true;

  nativeBuildInputs = [ makeWrapper ];

  dontConfigure = true;
  dontBuild = true;

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src" --strip-components=1
    runHook postUnpack
  '';

  installPhase = ''
      runHook preInstall

      packageRoot="$out/libexec/deepscientist"
      mkdir -p "$packageRoot" "$out/bin"
      cp -R . "$packageRoot/"
      chmod -R u+w "$packageRoot"
      rm -f "$packageRoot/.attrs.json" "$packageRoot/.attrs.sh" "$packageRoot/env-vars"
      cp -R ${nodeModules}/node_modules "$packageRoot/"
      substituteInPlace "$packageRoot/bin/ds.js" \
        --replace-fail \
          'function ensurePythonRuntime(home) {' \
          'function ensurePythonRuntime(home) {
    const nixRuntimePython = String(process.env.DEEPSCIENTIST_RUNTIME_PYTHON || "").trim();
    if (nixRuntimePython) {
      const runtimeProbe = probePython(nixRuntimePython);
      if (!runtimeProbe || !runtimeProbe.ok || !pythonMeetsMinimum(runtimeProbe) || !verifyPythonRuntime(nixRuntimePython)) {
      console.error("Configured Nix Python runtime is not healthy: " + nixRuntimePython);
        process.exit(1);
      }
      return {
        runtimePython: nixRuntimePython,
        uvBinary: String(process.env.DEEPSCIENTIST_UV || process.env.UV_BIN || "uv").trim(),
        runtimeManager: "nix",
        runtimeProbe: createRuntimeSelectionProbe(runtimeProbe, "nix"),
        sourcePython: runtimeProbe,
      };
    }'

      for launcherName in ${lib.concatStringsSep " " launcherNames}; do
        makeWrapper ${nodejs}/bin/node "$out/bin/$launcherName" \
          --add-flags "$packageRoot/bin/ds.js" \
          --set DEEPSCIENTIST_LAUNCHER_PATH "$out/bin/$launcherName" \
          --set DEEPSCIENTIST_RUNTIME_PYTHON "${runtimePython}" \
          --set DEEPSCIENTIST_UV "${uv}/bin/uv" \
          --prefix PATH : "${wrapperPath}"
      done

      runHook postInstall
  '';

  doInstallCheck = stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform;
  installCheckPhase = ''
    runHook preInstallCheck

    . ${../../lib/package.sh}

    assertExecutableSet "$out/bin" ${lib.escapeShellArgs launcherNames}

    "$out/bin/ds" --help > /dev/null
    "$out/bin/research" --help > /dev/null
    test -e "$out/libexec/deepscientist/pyproject.toml"
    test -e "$out/libexec/deepscientist/uv.lock"
    test -d "$out/libexec/deepscientist/src/ui/dist"
    test -d "$out/libexec/deepscientist/src/tui/dist"
    test -d "$out/libexec/deepscientist/node_modules"
    "$out/bin/ds" doctor --help > /dev/null
    ${lib.optionalString withClaudeCode ''
      grep -q '${claudePath}' "$out/bin/ds"
    ''}
    ${lib.optionalString withCodex ''
      grep -q '${codexPath}' "$out/bin/ds"
    ''}
    ${lib.optionalString withOpenCode ''
      grep -q '${opencodePath}' "$out/bin/ds"
    ''}

    runHook postInstallCheck
  '';

  meta = {
    homepage = "https://github.com/ResearAI/DeepScientist";
    license = lib.licenses.asl20;
    description = "Local-first autonomous research studio that keeps the full loop moving on your machine";
    mainProgram = "ds";
    platforms = packageLib.supportedSystems;
    sourceProvenance = with lib.sourceTypes; [
      fromSource
      binaryNativeCode
    ];
    changelog = "https://github.com/ResearAI/DeepScientist/releases/tag/v${pin.version}";
  };
}
