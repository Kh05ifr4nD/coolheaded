{
  lib,
  stdenvNoCC,
  fetchFromGitHub,
  fetchPnpmDeps,
  fetchurl,
  jq,
  makeWrapper,
  nodejs,
  packageLib,
  pnpm_10,
  pnpmConfigHook,
}:
let
  pname = "trellis";
  packageName = "@mindfoldhq/trellis";
  pin = builtins.fromJSON (builtins.readFile ./pin.json);
  packageSrc = fetchurl {
    url = "https://registry.npmjs.org/${packageName}/-/trellis-${pin.version}.tgz";
    hash =
      pin.hashes.${packageLib.system}
        or (throw "Missing ${pname} ${pin.version} package hash for ${packageLib.system}");
  };
  sourceSrc = fetchFromGitHub {
    owner = "mindfold-ai";
    repo = "Trellis";
    tag = "v${pin.version}";
    hash = pin.sourceHash;
  };
  pnpm = pnpm_10;
  pnpmWorkspaces = [ "${packageName}..." ];
  pnpmInstallFlags = [ "--prod" ];
  nodeModules = stdenvNoCC.mkDerivation {
    pname = "${pname}-node-modules";
    inherit (pin) version;
    src = sourceSrc;

    strictDeps = true;
    __structuredAttrs = true;
    inherit pnpmWorkspaces pnpmInstallFlags;

    pnpmDeps = fetchPnpmDeps {
      pname = "${pname}-${pin.version}";
      inherit (pin) version;
      src = sourceSrc;
      inherit pnpm;
      inherit pnpmWorkspaces pnpmInstallFlags;
      fetcherVersion = 3;
      hash = pin.pnpmDepsHash;
    };

    nativeBuildInputs = [
      nodejs
      pnpm
      pnpmConfigHook
    ];

    dontBuild = true;

    installPhase = ''
      runHook preInstall

      mkdir -p "$out"
      cp -R node_modules "$out/node_modules"
      chmod -R u+w "$out/node_modules"
      rm -f "$out/node_modules/.pnpm/node_modules/@mindfoldhq/trellis"
      cp -R packages/cli/node_modules/. "$out/node_modules/"
      find "$out/node_modules" -type l -exec sh -c '
        target=$(readlink "$1")
        case "$target" in
          ../../../node_modules/*)
            ln -sfn "''${target#../../../node_modules/}" "$1"
            ;;
        esac
      ' sh {} \;

      runHook postInstall
    '';
  };
  packageRoot = "${placeholder "out"}/libexec/${pname}";
in
stdenvNoCC.mkDerivation {
  inherit pname;
  inherit (pin) version;
  src = packageSrc;

  strictDeps = true;
  __structuredAttrs = true;

  nativeBuildInputs = [
    jq
    makeWrapper
  ];

  dontConfigure = true;
  dontBuild = true;

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src" --strip-components=1
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall

    packageRoot="$out/libexec/trellis"
    mkdir -p "$packageRoot" "$out/bin"
    cp -R . "$packageRoot/"
    chmod -R u+w "$packageRoot"
    rm -f "$packageRoot/.attrs.json" "$packageRoot/.attrs.sh" "$packageRoot/env-vars"
    jq 'del(.devDependencies, .scripts)' "$packageRoot/package.json" > "$packageRoot/package.json.tmp"
    mv "$packageRoot/package.json.tmp" "$packageRoot/package.json"
    cp -R ${nodeModules}/node_modules "$packageRoot/"

    makeWrapper ${lib.getExe nodejs} "$out/bin/trellis" \
      --add-flags "$packageRoot/bin/trellis.js"
    makeWrapper ${lib.getExe nodejs} "$out/bin/tl" \
      --add-flags "$packageRoot/bin/trellis.js"

    runHook postInstall
  '';

  doInstallCheck = packageLib.canExecute;
  nativeInstallCheckInputs = [ packageLib.versionCheckHook ];
  versionCheckProgram = "${placeholder "out"}/bin/trellis";
  versionCheckProgramArg = "--version";
  installCheckPhase = packageLib.mkInstallCheckPhase {
    executable = "$out/bin/trellis";
    helpContains = "Usage: trellis";
    extra = ''
      . ${../../lib/package.sh}

      assertFileExists "${packageRoot}/bin/trellis.js"
      assertFileExists "${packageRoot}/dist/cli/index.js"
      assertFileExists "${packageRoot}/dist/templates/trellis/index.js"
      assertFileExists "${packageRoot}/node_modules/chalk/package.json"
      test ! -e "${packageRoot}/node_modules/eslint" || failCheck "unexpected eslint dev dependency"
      test ! -e "${packageRoot}/node_modules/vitest" || failCheck "unexpected vitest dev dependency"
      "$out/bin/tl" --version >/dev/null
    '';
  };

  meta = {
    homepage = "https://github.com/mindfold-ai/trellis";
    changelog = "https://github.com/mindfold-ai/trellis/releases/tag/v${pin.version}";
    license = lib.licenses.agpl3Only;
    mainProgram = "trellis";
    platforms = packageLib.supportedSystems;
    description = "AI-assisted development workflow framework for Cursor, Claude Code and more";
  };
}
