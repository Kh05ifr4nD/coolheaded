{
  buildNpmPackage,
  deno,
  fetchNpmDeps,
  jq,
  lib,
  makeWrapper,
  nodejs,
  packageLib,
}:
packageLib.mkNpmCliPackage {
  inherit
    buildNpmPackage
    fetchNpmDeps
    jq
    makeWrapper
    nodejs
    ;

  pname = "hackmd-cli";
  packageName = "@hackmd/hackmd-cli";
  cliPath = "bin/run";
  launcherNames = [ "hackmd-cli" ];
  installItems = [
    "LICENSE"
    "README.md"
    "bin"
    "lib"
    "node_modules"
    "oclif.manifest.json"
    "package.json"
  ];

  installCheckExtra = ''
    export HOME="$PWD/installCheckHome"
    mkdir -p "$HOME"

    helpOutput="$("$out/bin/hackmd-cli" --help)"
    case "$helpOutput" in
      *"notes"*"teams"*"whoami"*) ;;
      *) failCheck "unexpected hackmd-cli --help output" ;;
    esac

    "$out/bin/hackmd-cli" notes create --help > /dev/null
    "$out/bin/hackmd-cli" export --help > /dev/null
    DENO_DIR="$TMPDIR/deno" ${lib.getExe deno} test --no-config --no-lock \
      --allow-env=HOME --allow-net=127.0.0.1 --allow-run="$out/bin/hackmd-cli" \
      ${./test.ts} -- "$out/bin/hackmd-cli"
  '';

  meta = {
    homepage = "https://github.com/hackmdio/hackmd-cli";
    license = lib.licenses.mit;
    description = "Official HackMD command line tool";
  };
}
