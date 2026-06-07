{
  lib,
  stdenv,
  fetchFromGitHub,
  autoPatchelfHook,
  bun,
  bun2nix,
  makeWrapper,
  node-gyp,
  nodejs,
  python3,
  sqlite,
  versionCheckHook,
  darwin,
  autoAddDriverRunpath,
  cudaPackages,
  vulkan-loader,
  withCuda ? false,
  withVulkan ? stdenv.hostPlatform.system == "x86_64-linux",
}:
let
  pname = "qmd";

  pin = builtins.fromJSON (builtins.readFile ./pin.json);

  inherit (stdenv.hostPlatform) system;
  canExecute = stdenv.buildPlatform.canExecute stdenv.hostPlatform;
  prebuildMap = {
    aarch64-darwin = {
      nodeLlamaCpp = [ "mac-arm64-metal" ];
      reflink = "reflink-darwin-arm64";
      sqliteVec = "sqlite-vec-darwin-arm64";
      treeSitter = "darwin-arm64";
    };
    aarch64-linux = {
      nodeLlamaCpp = [ "linux-arm64" ];
      reflink = "reflink-linux-arm64-gnu";
      sqliteVec = "sqlite-vec-linux-arm64";
      treeSitter = "linux-arm64";
    };
    x86_64-linux = {
      nodeLlamaCpp = [ "linux-x64" ];
      nodeLlamaCppCuda = [
        "linux-x64-cuda"
        "linux-x64-cuda-ext"
      ];
      nodeLlamaCppVulkan = [ "linux-x64-vulkan" ];
      reflink = "reflink-linux-x64-gnu";
      sqliteVec = "sqlite-vec-linux-x64";
      treeSitter = "linux-x64";
    };
  };
  prebuild = prebuildMap.${system} or (throw "Unsupported system for ${pname}: ${system}");
  effectiveCuda = withCuda && system == "x86_64-linux";
  effectiveVulkan = withVulkan && system == "x86_64-linux";
  nodeLlamaCppPrebuilds =
    prebuild.nodeLlamaCpp
    ++ lib.optionals effectiveCuda prebuild.nodeLlamaCppCuda
    ++ lib.optionals effectiveVulkan prebuild.nodeLlamaCppVulkan;

  src = fetchFromGitHub {
    owner = "tobi";
    repo = "qmd";
    tag = "v${pin.version}";
    inherit (pin) hash;
  };

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ./generatedPackage.nix;
    useFakeNode = false;
  };

  runtimeLibraries = [
    sqlite.out
  ]
  ++ lib.optionals effectiveCuda [
    cudaPackages.cuda_cudart
    cudaPackages.libcublas
  ]
  ++ lib.optionals effectiveVulkan [ vulkan-loader ];
  libraryPath = lib.makeLibraryPath runtimeLibraries;
in
stdenv.mkDerivation (finalAttrs: {
  inherit pname src;
  inherit (pin) version;

  strictDeps = true;
  __structuredAttrs = true;

  nativeBuildInputs = [
    bun2nix.hook
    bun
    makeWrapper
    node-gyp
    nodejs
    python3
  ]
  ++ lib.optionals effectiveCuda [ autoAddDriverRunpath ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ]
  ++ lib.optionals stdenv.hostPlatform.isDarwin [ darwin.cctools ];
  nativeInstallCheckInputs = [ versionCheckHook ];
  buildInputs = runtimeLibraries ++ lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];
  autoPatchelfIgnoreMissingDeps = lib.optionals effectiveCuda [ "libcuda.so.1" ];

  inherit bunDeps;

  bunInstallFlags = [
    "--frozen-lockfile"
    "--linker=hoisted"
    "--production"
  ]
  ++ lib.optionals stdenv.hostPlatform.isDarwin [ "--backend=copyfile" ];

  dontRunLifecycleScripts = true;
  dontStrip = true;

  buildPhase = ''
    runHook preBuild

    chmod -R u+w node_modules
    substituteInPlace node_modules/node-llama-cpp/dist/bindings/utils/detectGlibc.js \
      --replace-fail \
        'export async function detectGlibc({ platform }) {' \
        'export async function detectGlibc({ platform }) {
    if (platform === "linux")
        return true;'
    patch -p1 < ${./patch/nodeLlamaCppNixCompat.patch}
    (
      cd node_modules/better-sqlite3
      node-gyp rebuild --release
      find build -type f \( -name '*.d' -o -name '*.mk' -o -name Makefile -o -name '*.Makefile' \) -delete
      find build -mindepth 1 -maxdepth 1 ! -name Release -exec rm -rf {} +
      find build/Release -mindepth 1 ! -name better_sqlite3.node -exec rm -rf {} +
    )

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    . ${../../lib/package.sh}

    packageRoot="$out/libexec/qmd"
    mkdir -p "$packageRoot" "$out/bin"
    cp -R node_modules skills src package.json "$packageRoot/"

    keepOnlyMatchingChildren "$packageRoot/node_modules" "sqlite-vec-" '${prebuild.sqliteVec}'
    keepOnlyMatchingChildren "$packageRoot/node_modules/@reflink" "reflink-" '${prebuild.reflink}'
    keepOnlyMatchingChildren "$packageRoot/node_modules/@node-llama-cpp" "" ${lib.escapeShellArgs nodeLlamaCppPrebuilds}
    find "$packageRoot/node_modules" -path '*/prebuilds/*' -mindepth 3 -maxdepth 3 -type d ! -name '${prebuild.treeSitter}' \
      -exec rm -rf {} +
    makeWrapper ${bun}/bin/bun "$out/bin/qmd" \
      --add-flags "$packageRoot/src/cli/qmd.ts" \
      --set DYLD_LIBRARY_PATH "${sqlite.out}/lib" \
      --set LD_LIBRARY_PATH "${libraryPath}${lib.optionalString effectiveCuda ":/run/opengl-driver/lib"}" \
      --run 'if [ "''${1:-}" = mcp ]; then export LLAMA_LOG_LEVEL="''${LLAMA_LOG_LEVEL:-error}" GGML_LOG_LEVEL="''${GGML_LOG_LEVEL:-error}" GGML_BACKEND_SILENT="''${GGML_BACKEND_SILENT:-1}"; fi' \
      ${lib.optionalString stdenv.hostPlatform.isDarwin ''
        --run 'if [ "''${QMD_METAL_KEEP_RESIDENCY:-}" != 1 ]; then export GGML_METAL_NO_RESIDENCY="''${GGML_METAL_NO_RESIDENCY:-1}"; fi' \
      ''}

    runHook postInstall
  '';

  doInstallCheck = canExecute;
  versionCheckProgram = "${placeholder "out"}/bin/qmd";
  versionCheckProgramArg = "--version";
  installCheckPhase = ''
    runHook preInstallCheck

    . ${../../lib/package.sh}

    installCheckHome="$PWD/installCheckHome"
    mkdir -p "$installCheckHome"

    helpOutput="$(HOME="$installCheckHome" "$out/bin/qmd" --help 2>&1)"
    case "$helpOutput" in
      *"Usage:"*) ;;
      *) failCheck "unexpected qmd --help output" ;;
    esac

    HOME="$installCheckHome" "$out/bin/qmd" status > /dev/null
    HOME="$installCheckHome" "$out/bin/qmd" skills list | grep -q 'qmd'
    HOME="$installCheckHome" "$out/bin/qmd" skills get qmd | grep -q 'name: qmd'
    HOME="$installCheckHome" "$out/bin/qmd" skills path qmd | grep -q "$out/libexec/qmd/skills/qmd"
    HOME="$installCheckHome" "$out/bin/qmd" skill show | grep -q 'name: qmd'

    runHook postInstallCheck
  '';

  meta = {
    homepage = "https://github.com/tobi/qmd";
    license = lib.licenses.mit;
    description = "Mini CLI search engine for your docs, knowledge bases, meeting notes, whatever";
    mainProgram = pname;
    platforms = [
      "aarch64-darwin"
      "aarch64-linux"
      "x86_64-linux"
    ];
    sourceProvenance = with lib.sourceTypes; [
      fromSource
      binaryNativeCode
    ];
    changelog = "https://github.com/tobi/qmd/releases/tag/v${finalAttrs.version}";
  };
})
