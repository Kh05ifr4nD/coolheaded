{
  lib,
  stdenv,
  autoPatchelfHook,
  makeWrapper,
  nodejs,
  packageLib,
}:
let
  pname = "lazycodex-ai";

  platformMap = {
    aarch64-darwin = {
      biome = "cli-darwin-arm64";
      commentChecker = "darwin-arm64";
      lightningcss = "lightningcss-darwin-arm64";
      rolldown = "binding-darwin-arm64";
    };
    aarch64-linux = {
      biome = "cli-linux-arm64";
      commentChecker = "linux-arm64";
      lightningcss = "lightningcss-linux-arm64-gnu";
      rolldown = "binding-linux-arm64-gnu";
    };
    x86_64-linux = {
      biome = "cli-linux-x64";
      commentChecker = "linux-x64";
      lightningcss = "lightningcss-linux-x64-gnu";
      rolldown = "binding-linux-x64-gnu";
    };
  };
  platform = packageLib.releaseTarget pname platformMap;

  packageName = "lazycodex-ai";
  packageRoot = "${placeholder "out"}/libexec/lazycodex-ai";
  nodePath = lib.makeBinPath [ nodejs ];
in
packageLib.mkNpmTarballPackage {
  inherit pname;
  inherit packageName;
  changelog =
    { version, ... }: "https://github.com/code-yeongyu/oh-my-openagent/releases/tag/v${version}";

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

    . ${../../lib/package.sh}

    packageRoot="$out/libexec/lazycodex-ai"
    mkdir -p "$packageRoot" "$out/bin"
    cp -R . "$packageRoot/"
    rm -f "$packageRoot/.attrs.json" "$packageRoot/.attrs.sh" "$packageRoot/env-vars"
    find "$packageRoot/packages/omo-codex/plugin" -type d -name .github -prune -exec rm -rf {} +

    pluginNodeModules="$packageRoot/packages/omo-codex/plugin/node_modules"
    keepOnlyMatchingChildren "$pluginNodeModules/@biomejs" "cli-" '${platform.biome}'
    keepOnlyMatchingChildren "$pluginNodeModules/@rolldown" "binding-" '${platform.rolldown}'
    keepOnlyMatchingChildren "$pluginNodeModules" "lightningcss-" '${platform.lightningcss}'
    keepOnlyMatchingChildren "$pluginNodeModules/@code-yeongyu/comment-checker/vendor" "" '${platform.commentChecker}'
    makeWrapper "${nodejs}/bin/node" "$out/bin/lazycodex-ai" \
      --add-flags "$packageRoot/packages/omo-codex/scripts/install-local.mjs" \
      --prefix PATH : "${nodePath}"

    runHook postInstall
  '';

  versionCheckProgram = "${placeholder "out"}/bin/lazycodex-ai";
  installCheck.extra = ''
    helpOutput="$("$out/bin/lazycodex-ai" --help 2>&1)"
    case "$helpOutput" in
      *"Usage: lazycodex-ai install"*) ;;
      *) failCheck "unexpected lazycodex-ai --help output" ;;
    esac

    dryRunOutput="$("$out/bin/lazycodex-ai" --dry-run 2>&1)"
    case "$dryRunOutput" in
      *"omo install"*) ;;
      *) failCheck "unexpected lazycodex-ai --dry-run output" ;;
    esac

    test ! -e "$out/bin/lazycodex" || failCheck "unexpected lazycodex compatibility launcher"
    assertFileExists "${packageRoot}/packages/omo-codex/marketplace.json"
    assertFileExists "${packageRoot}/packages/omo-codex/scripts/install-local.mjs"
  '';

  meta = {
    homepage = "https://www.npmjs.com/package/lazycodex-ai";
    license = lib.licenses.unfree;
    description = "The one and only agent harness for complex codebases. Project memory, planning, execution, and verified completion inside Codex";
  };
}
