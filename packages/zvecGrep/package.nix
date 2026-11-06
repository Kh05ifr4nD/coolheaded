{
  autoPatchelfHook,
  lib,
  packageLib,
  stdenv,
}:

let
  inherit (stdenv.hostPlatform) isLinux;
  pname = "zvec-grep";
  targets = builtins.fromJSON (builtins.readFile ./platforms.json);
in
packageLib.mkReleaseBinaryPackage {
  inherit pname targets;
  mainProgram = "zg";

  asset = { target, version }: "${packageLib.npmTarballName target}-${version}.tgz";
  url = { target, releaseAsset, ... }: "https://registry.npmjs.org/${target}/-/${releaseAsset}";
  changelog = { version, ... }: "https://github.com/zvec-ai/zvec-grep/releases/tag/v${version}";

  nativeBuildInputs = lib.optionals isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals isLinux [ stdenv.cc.cc.lib ];

  installPhase = ''
    runHook preInstall

    install -Dm755 bin/zg "$out/bin/zg"
    cp -R lib "$out/"
    install -Dm644 LICENSE "$out/share/licenses/${pname}/LICENSE"

    runHook postInstall
  '';

  preFixup = lib.optionalString isLinux ''
    autoPatchelfFlags+=(--preserve-origin --relativize-rpath)
    addAutoPatchelfSearchPath "$out/lib"
  '';

  meta = {
    description = "Local-first workspace search for humans and AI agents";
    homepage = "https://github.com/zvec-ai/zvec-grep";
    license = lib.licenses.asl20;
  };
}
