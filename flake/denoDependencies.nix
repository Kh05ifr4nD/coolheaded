{
  deno,
  lib,
  pkgs,
}:

let
  hash = "sha256-t1/jJYZD5asPO6OlUM7po2lp7NORHP/wW6dm3TJddyo=";

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
    outputHash = hash;
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

    rm -f node_modules/.deno/.setup-cache.bin

    mkdir -p "$out"
    cp -a node_modules "$out/node_modules"
  ''
