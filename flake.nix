{
  description = "Nix-packaged AI tools, developer CLIs, linters, and update automation";

  inputs = {
    bun2nix = {
      url = "github:nix-community/bun2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    flakeParts.url = "github:hercules-ci/flake-parts";
    gitHooksNix = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    pyprojectBuildSystems = {
      url = "github:pyproject-nix/build-system-pkgs";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.pyproject-nix.follows = "pyprojectNix";
      inputs.uv2nix.follows = "uv2nix";
    };
    pyprojectNix = {
      url = "github:pyproject-nix/pyproject.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    treefmtNix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    uv2nix = {
      url = "github:pyproject-nix/uv2nix";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.pyproject-nix.follows = "pyprojectNix";
    };
    wrapBuddy = {
      url = "github:Mic92/wrap-buddy";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-parts.follows = "flakeParts";
      inputs.treefmt-nix.follows = "treefmtNix";
    };
  };

  outputs =
    inputs@{
      bun2nix,
      flakeParts,
      gitHooksNix,
      nixpkgs,
      pyprojectBuildSystems,
      pyprojectNix,
      self,
      treefmtNix,
      uv2nix,
      wrapBuddy,
      ...
    }:
    let
      systemConfig = builtins.fromJSON (builtins.readFile ./lib/ts/system/targets.json);
      supportedSystems = map (target: target.system) systemConfig.targets;
    in
    flakeParts.lib.mkFlake { inherit inputs; } {
      imports = [
        gitHooksNix.flakeModule
        treefmtNix.flakeModule
      ];

      flake.overlays.default = import ./flake/overlay.nix {
        inherit
          bun2nix
          pyprojectBuildSystems
          pyprojectNix
          uv2nix
          wrapBuddy
          ;
      };

      flake.homeModules =
        let
          modules = nixpkgs.lib.pipe (builtins.readDir ./homeModules) [
            (nixpkgs.lib.filterAttrs (
              name: type: name != "default.nix" && type == "regular" && nixpkgs.lib.hasSuffix ".nix" name
            ))
            (nixpkgs.lib.mapAttrs' (
              file: _:
              nixpkgs.lib.nameValuePair (nixpkgs.lib.removeSuffix ".nix" file) (
                import (./homeModules + "/${file}") { inherit self; }
              )
            ))
          ];
        in
        modules // { default = import ./homeModules/default.nix { inherit self; }; };

      perSystem =
        {
          config,
          pkgs,
          system,
          ...
        }:
        {
          _module.args.pkgs = import nixpkgs {
            inherit system;
            config.allowUnfreePredicate =
              pkg:
              let
                licenses = nixpkgs.lib.toList (pkg.meta.license or [ ]);
              in
              builtins.any (license: !(license.free or true)) licenses;
          };
          checks = import ./flake/checks.nix {
            inherit pkgs;
            inherit (config) packages;
            inherit (pkgs) lib;
          };
          devShells.default = import ./flake/devShell.nix { inherit config pkgs; };
          packages = import ./flake/packages.nix {
            lib = pkgs.lib;
            inherit
              pkgs
              bun2nix
              pyprojectBuildSystems
              pyprojectNix
              uv2nix
              wrapBuddy
              ;
          };
          pre-commit.settings = import ./flake/gitHooks.nix { inherit config pkgs; };
          treefmt = import ./flake/treefmt.nix { inherit config pkgs; };
        };

      systems = supportedSystems;
    };
}
