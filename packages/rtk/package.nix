{
  lib,
  stdenv,
  rustPlatform,
  fetchFromGitHub,
  jq,
  makeWrapper,
  versionCheckHook,
}:
let
  pname = "rtk";

  pin = builtins.fromJSON (builtins.readFile ./pin.json);

  canExecute = stdenv.buildPlatform.canExecute stdenv.hostPlatform;
in
rustPlatform.buildRustPackage (finalAttrs: {
  inherit pname;
  inherit (pin) version;

  src = fetchFromGitHub {
    owner = "rtk-ai";
    repo = "rtk";
    tag = "v${finalAttrs.version}";
    hash = pin.sourceHash;
  };

  cargoHash = pin.cargoVendorHash;

  strictDeps = true;
  __structuredAttrs = true;

  nativeBuildInputs = [ makeWrapper ];
  nativeInstallCheckInputs = [ versionCheckHook ];

  doCheck = false;

  preBuild = ''
    export RUSTFLAGS="$RUSTFLAGS --remap-path-prefix=$NIX_BUILD_TOP=/build ${lib.optionalString stdenv.hostPlatform.isDarwin "-C link-arg=-Wl,-no_uuid"}"
  '';

  postInstall = ''
    hooksRoot="$out/libexec/rtk/hooks"
    mkdir -p "$hooksRoot"
    cp -R "$src/hooks/." "$hooksRoot/"
    chmod -R u+w "$hooksRoot"
    find "$hooksRoot" -name '*.sh' -exec chmod 755 {} \;
    while IFS= read -r hook; do
      wrapProgram "$hook" \
        --prefix PATH : ${lib.makeBinPath [ jq ]}:$out/bin
    done < <(find "$hooksRoot" -name '*.sh' -print)
  '';

  doInstallCheck = canExecute;
  versionCheckProgram = "${placeholder "out"}/bin/rtk";
  versionCheckProgramArg = "--version";
  installCheckPhase = ''
    runHook preInstallCheck

    "$out/bin/rtk" --help > /dev/null
    test -e "$out/libexec/rtk/hooks/claude/rtk-rewrite.sh"
    test -e "$out/libexec/rtk/hooks/cursor/rtk-rewrite.sh"

    runHook postInstallCheck
  '';

  meta = {
    homepage = "https://github.com/rtk-ai/rtk";
    license = lib.licenses.asl20;
    description = "CLI proxy that reduces LLM token consumption by 60-90% on common dev commands";
    mainProgram = pname;
    platforms = lib.platforms.unix;
    sourceProvenance = with lib.sourceTypes; [ fromSource ];
    changelog = "https://github.com/rtk-ai/rtk/releases/tag/v${finalAttrs.version}";
  };
})
