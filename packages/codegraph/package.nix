{
  lib,
  stdenv,
  autoPatchelfHook,
  makeWrapper,
  packageLib,
}:
packageLib.mkGitHubReleaseBinaryPackage {
  pname = "codegraph";
  owner = "colbymchenry";

  targets = packageLib.npmReleaseTargets;
  asset = { target, version }: "codegraph-${target}.tar.gz";

  nativeBuildInputs = [
    makeWrapper
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src" --strip-components=1
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall

    packageRoot="$out/libexec/codegraph"
    mkdir -p "$packageRoot" "$out/bin"
    cp -R bin lib node "$packageRoot/"
    makeWrapper "$packageRoot/node" "$out/bin/codegraph" \
      --add-flags "--liftoff-only" \
      --add-flags "$packageRoot/lib/dist/bin/codegraph.js"

    runHook postInstall
  '';

  installCheck = {
    helpContains = "Usage: codegraph";
    extra = ''
      checkTestDir="$(mktemp -d)"
      statusOutput="$("$out/bin/codegraph" status "$checkTestDir" 2>&1)"
      case "$statusOutput" in
        *"Not initialized"*) ;;
        *) failCheck "unexpected codegraph status output" ;;
      esac
    '';
  };

  meta = {
    license = lib.licenses.mit;
    description = "Local-first code-intelligence tool that turns any codebase into a queryable knowledge graph for AI coding agents";
  };
}
