{
  deno,
  lib,
  pkgs,
}:

let
  hashes = {
    aarch64-darwin = "sha256-9OA7/TYf5Dnk8cL4S05wpJyKuTEBu4hVkyj5RMYkSoc=";
    aarch64-linux = "sha256-/GifO3Y0B9ien7bfNdb4xIAzEdFT6aFMdoaU2j1sOuA=";
    x86_64-linux = "sha256-/GifO3Y0B9ien7bfNdb4xIAzEdFT6aFMdoaU2j1sOuA=";
  };

  system = pkgs.stdenv.hostPlatform.system;

  source = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../deno.jsonc
      ../deno.lock
    ];
  };
in

pkgs.runCommand "coolheaded-deno-dependencies"
  {
    nativeBuildInputs = [ deno ];
    outputHash = hashes.${system} or (throw "Missing Deno dependency hash for ${system}");
    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
  }
  ''
    mkdir source
    cp -a ${source}/. source/
    chmod -R u+w source
    cd source

    export DENO_DIR="$TMPDIR/deno-cache"
    export HOME="$TMPDIR/home"
    mkdir -p "$DENO_DIR" "$HOME"

    deno install

    mkdir -p "$out"
    cp -a node_modules "$out/node_modules"
  ''
