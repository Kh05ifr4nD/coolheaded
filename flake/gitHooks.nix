{ config, pkgs }:

let
  inherit (config) packages;

  denoDependenciesHashes = {
    aarch64-darwin = "sha256-H0SlO/fxcwXUYqLEij2ICwejpN1BpoL7veR8FW2glR8=";
    aarch64-linux = "sha256-9Z+gHfZS+bVKJgYMZFCg9DfsQiZEoen1JajpLHe2QLk=";
    x86_64-linux = "sha256-9Z+gHfZS+bVKJgYMZFCg9DfsQiZEoen1JajpLHe2QLk=";
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

  gitHook = entry: {
    enable = true;
    package = pkgs.git;
    inherit entry;
  };
in

{
  rootSrc = pkgs.lib.mkForce preCommitRootSrc;

  hooks = {
    appendDco =
      gitHook ''
        ${pkgs.runtimeShell} -eu -c '
          commitMessageFile="$1"
          signer="$(git var GIT_COMMITTER_IDENT | sed "s/>.*/>/")"

          git interpret-trailers \
            --in-place \
            --if-exists doNothing \
            --trailer "Signed-off-by: $signer" \
            "$commitMessageFile"
        ' appendDco
      ''
      // {
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
