{
  lib,
  stdenv,
  rustPlatform,
  fetchFromGitHub,
  versionCheckHook,
}:
let
  pname = "deadnix";
  pin = builtins.fromJSON (builtins.readFile ./pin.json);

  canExecute = stdenv.buildPlatform.canExecute stdenv.hostPlatform;
in
rustPlatform.buildRustPackage (finalAttrs: {
  inherit pname;
  inherit (pin) version;

  src = fetchFromGitHub {
    owner = "astro";
    repo = pname;
    tag = "v${finalAttrs.version}";
    hash = pin.sourceHash;
  };

  cargoHash = pin.cargoVendorHash;

  strictDeps = true;
  __structuredAttrs = true;

  nativeInstallCheckInputs = [ versionCheckHook ];

  doInstallCheck = canExecute;
  versionCheckProgram = "${placeholder "out"}/bin/deadnix";
  versionCheckProgramArg = "--version";
  installCheckPhase = ''
    runHook preInstallCheck

    "$out/bin/deadnix" --help > /dev/null
    checkTestDir="$(mktemp -d)"
    cat > "$checkTestDir/input.nix" <<'EOF'
    let
      unused = 1;
    in
    2
    EOF
    "$out/bin/deadnix" "$checkTestDir/input.nix" | grep -F "unused"

    runHook postInstallCheck
  '';

  meta = {
    homepage = "https://github.com/astro/deadnix";
    license = lib.licenses.gpl3Only;
    description = "Scan Nix files for dead code";
    mainProgram = pname;
    platforms = lib.platforms.unix;
    sourceProvenance = with lib.sourceTypes; [ fromSource ];
    changelog = "https://github.com/astro/deadnix/releases/tag/v${finalAttrs.version}";
  };
})
