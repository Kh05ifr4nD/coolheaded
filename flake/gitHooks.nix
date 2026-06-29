{ config, pkgs }:

let
  inherit (config) packages;

  denoDependenciesHashes = {
    aarch64-darwin = "sha256-y7n31mS+OWlxmq3MSJd+tFqkwzt3S7Ba8pkFGGk40n8=";
    aarch64-linux = "sha256-J1DRBjz4IufmCNWEphwYhqei1BnGv0Pt5tmylT3kcWM=";
    x86_64-linux = "sha256-J1DRBjz4IufmCNWEphwYhqei1BnGv0Pt5tmylT3kcWM=";
  };

  denoDependencies =
    pkgs.runCommand "coolheaded-deno-dependencies"
      {
        nativeBuildInputs = [ packages.deno ];
        outputHash =
          denoDependenciesHashes.${pkgs.stdenv.hostPlatform.system}
            or (throw "Missing Deno dependency hash for ${pkgs.stdenv.hostPlatform.system}");
        outputHashAlgo = "sha256";
        outputHashMode = "recursive";
      }
      ''
        cp -a ${pkgs.lib.cleanSource ../.} source
        chmod -R u+w source
        cd source

        export DENO_DIR="$TMPDIR/deno-cache"
        export HOME="$TMPDIR/home"
        mkdir -p "$DENO_DIR" "$HOME"

        deno install
        deno cache --lock=deno.lock --config=deno.jsonc .github/ci/**/*.ts packages/*/update.ts src/**/*.ts tests/**/*.ts

        mkdir -p "$out"
        cp -a node_modules "$out/node_modules"
        cp -a "$DENO_DIR" "$out/deno-cache"
      '';

  preCommitRootSrc =
    pkgs.runCommand "coolheaded-pre-commit-source" { nativeBuildInputs = [ packages.deno ]; }
      ''
        cp -a ${pkgs.lib.cleanSource ../.} "$out"
        chmod -R u+w "$out"
        cp -a ${denoDependencies}/node_modules "$out/node_modules"
        cp -a ${denoDependencies}/deno-cache "$out/.deno-cache"
        mkdir -p "$out/.generated"
        deno types > "$out/.generated/deno.d.ts"
      '';

  denoTaskHook = task: extraPackages: {
    enable = true;
    package = packages.deno;
    inherit extraPackages;
    entry = "env DENO_DIR=.deno-cache ${packages.deno}/bin/deno task ${task}";
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

    denoCheck = denoTaskHook "check" [ ];
    denoTest = denoTaskHook "test" [ ];

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
      settings = {
        configPath = ".oxlintrc.jsonc";
        tsconfig = "tsconfig.json";
        typeAware = true;
        typeCheck = true;
      };
    };

    shellcheck = {
      enable = true;
      package = packages.shellcheck;
      files = "^lib/package\\.sh$";
    };

    treefmt = {
      enable = true;
      packageOverrides.treefmt = config.treefmt.build.wrapper;
    };
  };
}
