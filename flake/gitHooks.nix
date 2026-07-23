{ config, pkgs }:

let
  inherit (config) packages;

  denoDependencies = import ./denoDependencies.nix {
    inherit pkgs;
    inherit (pkgs) lib;
    deno = packages.deno;
  };

  preCommitRootSrc =
    pkgs.runCommand "coolheaded-pre-commit-source" { nativeBuildInputs = [ packages.deno ]; }
      ''
        cp -a ${pkgs.lib.cleanSource ../.} "$out"
        chmod -R u+w "$out"
        cp -a ${denoDependencies}/node_modules "$out/node_modules"
        mkdir -p "$out/.generated"
        deno types > "$out/.generated/deno.d.ts"
      '';

  denoTaskHook = task: extraPackages: {
    enable = true;
    package = packages.deno;
    extraPackages = extraPackages ++ [ pkgs.git ];
    entry = "${pkgs.coreutils}/bin/env COOLHEADED_CUE=${packages.cue}/bin/cue COOLHEADED_GIT=${pkgs.git}/bin/git ${packages.deno}/bin/deno task ${task}";
    pass_filenames = false;
    always_run = true;
  };

  appendDco = pkgs.writeShellApplication {
    name = "append-dco";
    runtimeInputs = [ pkgs.git ];
    text = ''
      set -eu

      commitMessageFile="$1"
      ident="$(git var GIT_COMMITTER_IDENT)"
      signer="''${ident%%>*}>"

      git interpret-trailers \
        --in-place \
        --if-exists addIfDifferent \
        --if-missing add \
        --trailer "Signed-off-by: $signer" \
        "$commitMessageFile"
    '';
  };
in

{
  rootSrc = pkgs.lib.mkForce preCommitRootSrc;

  hooks = {
    appendDco = {
      enable = true;
      name = "Append DCO sign-off";
      package = appendDco;
      entry = pkgs.lib.getExe appendDco;
      stages = [ "prepare-commit-msg" ];
    };

    denoCheck = denoTaskHook "check" [ packages.cue ];
    denoTest = denoTaskHook "test" [ packages.cue ];

    denolint = {
      enable = true;
      package = packages.deno;
      pass_filenames = false;
      always_run = true;
      settings.configPath = "deno.jsonc";
    };

    actionlint = {
      enable = true;
      package = packages.actionlint;
    };

    deadnix = {
      enable = true;
      package = packages.deadnix;
    };

    oxlint = {
      enable = true;
      package = packages.oxlint;
      pass_filenames = false;
      settings = {
        configPath = ".oxlintrc.jsonc";
        tsconfig = "tsconfig.json";
        typeAware = true;
        typeCheck = true;
      };
    };

    shellcheck = {
      enable = true;
      package = packages.shellCheck;
      files = "^lib/package\\.sh$";
    };

    treefmt = {
      enable = true;
      packageOverrides.treefmt = config.treefmt.build.wrapper;
    };
  };
}
