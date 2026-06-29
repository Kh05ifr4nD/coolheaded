{ config, pkgs }:

pkgs.mkShellNoCC {
  packages = (
    with config;
    pre-commit.settings.enabledPackages
    ++ [
      pkgs.cue
      treefmt.build.wrapper
    ]
    ++ (with packages; [ deno ])
  );

  shellHook = ''
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
