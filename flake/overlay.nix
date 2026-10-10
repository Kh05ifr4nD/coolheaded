{
  pyprojectBuildSystems,
  pyprojectNix,
  uv2nix,
}:

final: _prev:

{
  coolheaded = import ./packageSet.nix {
    lib = final.lib;
    pkgs = final;
    inherit pyprojectBuildSystems pyprojectNix uv2nix;
  };
}
