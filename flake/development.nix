{
  inputs,
  packages,
  pkgsFor,
  systems,
}:
inputs.flakeParts.lib.mkFlake { inherit inputs; } {
  imports = [
    inputs.gitHooksNix.flakeModule
    inputs.treefmtNix.flakeModule
  ];

  inherit systems;

  perSystem =
    {
      config,
      pkgs,
      system,
      ...
    }:
    {
      _module.args.pkgs = pkgsFor.${system};
      packages = packages.${system};
      checks = import ./checks.nix {
        inherit inputs pkgs;
        inherit (config) packages;
        inherit (pkgs) lib;
      };
      devShells.default = import ./devShell.nix { inherit config pkgs; };
      pre-commit.settings = import ./gitHooks.nix { inherit config pkgs; };
      treefmt = import ./treefmt.nix { inherit config pkgs; };
    };
}
