{
  lib,
  stdenv,
  autoPatchelfHook,
  packageLib,
}:
packageLib.mkReleaseBinaryPackage {
  pname = "antigravity-cli";
  mainProgram = "agy";

  targets = {
    aarch64-darwin = "darwin-arm/cli_mac_arm64.tar.gz";
    aarch64-linux = "linux-arm/cli_linux_arm64.tar.gz";
    x86_64-linux = "linux-x64/cli_linux_x64.tar.gz";
  };
  asset = { target, ... }: target;
  url =
    { releaseAsset, version, ... }:
    "https://storage.googleapis.com/antigravity-public/antigravity-cli/${version}/${releaseAsset}";

  nativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src"
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 antigravity "$out/bin/agy"
    runHook postInstall
  '';

  installCheck = {
    helpContains = "Usage of antigravity:";
    extra = ''
      "$out/bin/agy" help > /dev/null
    '';
  };

  meta = {
    homepage = "https://antigravity.google/";
    changelog = "https://github.com/google-antigravity/antigravity-cli/blob/main/CHANGELOG.md";
    license = lib.licenses.unfree;
    description = "CLI for Google Antigravity";
  };
}
