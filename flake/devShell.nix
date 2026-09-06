{ config, pkgs }:

pkgs.mkShellNoCC {
  packages = (
    with config;
    pre-commit.settings.enabledPackages
    ++ [ treefmt.build.wrapper ]
    ++ [
      packages.cue
      pkgs.deno
      pkgs.git
    ]
  );

  shellHook = ''
    export COOLHEADED_CUE="${config.packages.cue}/bin/cue"
    export COOLHEADED_DENO="${pkgs.deno}/bin/deno"
    export COOLHEADED_GIT="${pkgs.git}/bin/git"
    export COOLHEADED_GIT_DIR="$(${pkgs.git}/bin/git rev-parse --path-format=absolute --git-common-dir)"
    export DENO_V8_FLAGS="--max-old-space-size=4096"

    ${config.pre-commit.shellHook}

    generatedDir="$PWD/.generated"
    denoTypesPath="$generatedDir/deno.d.ts"

    mkdir -p "$generatedDir"
    denoTypesTmp="$(mktemp "$generatedDir/deno.d.ts.XXXXXX")"
    ${pkgs.deno}/bin/deno types > "$denoTypesTmp"
    if ! cmp -s "$denoTypesTmp" "$denoTypesPath"; then
      mv "$denoTypesTmp" "$denoTypesPath"
    else
      rm "$denoTypesTmp"
    fi

    deno install
  '';
}
