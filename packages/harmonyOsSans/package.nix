{
  lib,
  stdenvNoCC,
  fetchurl,
  unzip,
}:
let
  pin = builtins.fromJSON (builtins.readFile ./pin.json);
in
stdenvNoCC.mkDerivation {
  pname = "harmonyOsSans";
  inherit (pin) version;

  src = fetchurl {
    name = "harmonyOsSans.zip";
    url = "https://media.githubusercontent.com/media/huawei-fonts/HarmonyOS-Sans/${pin.rev}/HarmonyOS%20Sans.zip";
    hash = pin.packageHash;
  };

  nativeBuildInputs = [ unzip ];
  sourceRoot = "HarmonyOS Sans";

  installPhase = ''
    runHook preInstall
    find . -name '*.ttf' -exec install -Dm644 -t "$out/share/fonts/truetype" {} +
    runHook postInstall
  '';

  meta = {
    description = "HarmonyOS Sans font family";
    homepage = "https://github.com/huawei-fonts/HarmonyOS-Sans";
    license = lib.licenses.unfreeRedistributable;
    platforms = lib.platforms.all;
  };
}
