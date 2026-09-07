{
  bun2nix,
  pyprojectBuildSystems,
  pyprojectNix,
  uv2nix,
}:

final: _prev:

{
  coolheaded = import ./packageSet.nix {
    lib = final.lib;
    pkgs = final;
    inherit
      bun2nix
      pyprojectBuildSystems
      pyprojectNix
      uv2nix
      ;
  };
}
