{
  inputs,
  lib,
  packages,
  pkgs,
}:
let
  system = pkgs.stdenv.hostPlatform.system;
  consumer = (import ../flake.nix).outputs (
    inputs
    // {
      flakeParts = throw "consumer evaluated flake-parts";
      gitHooksNix = throw "consumer evaluated Git hooks";
      treefmtNix = throw "consumer evaluated treefmt";
    }
  );
  isolatedPackages = import ./packageSet.nix {
    lib = lib // {
      makeScope =
        newScope: fn:
        (lib.makeScope newScope fn) // { zvecGrep = throw "consumer evaluated an unrelated package"; };
    };
    inherit pkgs;
    inherit (inputs) pyprojectBuildSystems pyprojectNix uv2nix;
  };
  checksWithLicense =
    license:
    import ./checks.nix {
      inherit inputs lib pkgs;
      packages = packages // {
        cass = packages.cass // {
          meta = packages.cass.meta // {
            inherit license;
          };
        };
      };
    };
  acceptsLicense =
    license: (builtins.tryEval (builtins.attrNames (checksWithLicense license))).success;
in
assert lib.assertMsg (
  consumer.packages.${system}.cass.drvPath == packages.cass.drvPath
) "package consumption must be independent of development inputs";
assert lib.assertMsg (
  (consumer.overlays.default pkgs pkgs).coolheaded.cass.drvPath == packages.cass.drvPath
) "overlay consumption must be independent of development inputs";
assert lib.assertMsg (
  builtins.attrNames consumer.homeModules == builtins.attrNames inputs.self.homeModules
) "Home Manager module discovery must be independent of development inputs";
assert lib.assertMsg (
  isolatedPackages.cass.drvPath == packages.cass.drvPath
) "package consumption must be independent of unrelated packages";
assert lib.assertMsg (acceptsLicense [
  lib.licenses.mit
  lib.licenses.unfree
]) "license validation must accept explicit free and non-free metadata";
assert lib.assertMsg (!acceptsLicense [ ]) "license validation must reject missing licenses";
assert lib.assertMsg (
  !acceptsLicense { free = true; }
) "license validation must require redistributable metadata";
assert lib.assertMsg (
  !acceptsLicense { redistributable = true; }
) "license validation must require free metadata";
pkgs.runCommand "coolheaded-evaluation" { } ''
  touch "$out"
''
