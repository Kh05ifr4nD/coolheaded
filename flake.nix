{
  description = "Nix-packaged AI tools, developer CLIs, linters, and update automation";

  inputs = {
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
  };

  outputs =
    inputs@{
      nixpkgs,
      pyprojectBuildSystems,
      pyprojectNix,
      self,
      uv2nix,
      ...
    }:
    let
      inherit (nixpkgs) lib;
      systemConfig = builtins.fromJSON (builtins.readFile ./lib/ts/system/targets.json);
      supportedSystems = map (target: target.system) systemConfig.targets;
      forAllSystems = lib.genAttrs supportedSystems;
      pkgsFor = forAllSystems (
        system:
        import nixpkgs {
          inherit system;
          config.allowUnfreePredicate =
            pkg: lib.any (license: !(license.free or true)) (lib.toList (pkg.meta.license or [ ]));
        }
      );
      packages = forAllSystems (
        system:
        import ./flake/packageSet.nix {
          pkgs = pkgsFor.${system};
          inherit
            lib
            pyprojectBuildSystems
            pyprojectNix
            uv2nix
            ;
        }
      );
      development = import ./flake/development.nix {
        inherit inputs packages pkgsFor;
        systems = supportedSystems;
      };
    in
    {
      inherit packages;
      inherit (development)
        apps
        checks
        devShells
        formatter
        legacyPackages
        nixosConfigurations
        nixosModules
        ;

      overlays.default = import ./flake/overlay.nix {
        inherit pyprojectBuildSystems pyprojectNix uv2nix;
      };

      homeModules =
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
    };
}
