{ config, pkgs }:

pkgs.mkShellNoCC {
  packages = (
    with config;
    pre-commit.settings.enabledPackages
    ++ [ treefmt.build.wrapper ]
    ++ (with packages; [
      cue
      deno
      pkgs.git
    ])
  );

  shellHook = ''
    export COOLHEADED_CUE="${config.packages.cue}/bin/cue"
    export COOLHEADED_DENO="${config.packages.deno}/libexec/deno/bin/deno"
    export COOLHEADED_GIT="${pkgs.git}/bin/git"
    export COOLHEADED_GIT_DIR="$(${pkgs.git}/bin/git rev-parse --path-format=absolute --git-common-dir)"

    ${config.pre-commit.shellHook}

    generatedDir="$PWD/.generated"
    denoTypesPath="$generatedDir/deno.d.ts"

    mkdir -p "$generatedDir"
    denoTypesTmp="$(mktemp "$generatedDir/deno.d.ts.XXXXXX")"
    ${config.packages.deno}/bin/deno types > "$denoTypesTmp"
    if ! cmp -s "$denoTypesTmp" "$denoTypesPath"; then
      mv "$denoTypesTmp" "$denoTypesPath"
    else
      rm "$denoTypesTmp"
    fi

    deno install
  '';
}
