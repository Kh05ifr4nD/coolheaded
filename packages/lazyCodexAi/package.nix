{
  lib,
  stdenv,
  autoPatchelfHook,
  ast-grep,
  fetchurl,
  makeWrapper,
  nodejs,
  packageLib,
}:
let
  pname = "lazycodex-ai";
  pin = builtins.fromJSON (builtins.readFile ./pin.json);
  commentCheckerPin = builtins.fromJSON (builtins.readFile ./commentChecker.json);

  platform = packageLib.releaseTarget pname {
    aarch64-darwin = "darwin-arm64";
    aarch64-linux = "linux-arm64";
    x86_64-linux = "linux-x64";
  };
  commentCheckerSrc = fetchurl {
    url = "https://registry.npmjs.org/@code-yeongyu/comment-checker/-/comment-checker-${commentCheckerPin.version}.tgz";
    hash = commentCheckerPin.packageHash;
  };
  packageName = "lazycodex-ai";
  packageRoot = "${placeholder "out"}/libexec/lazycodex-ai";
  nodeExecutable = "${nodejs}/bin/node";
  nodePath = lib.makeBinPath [
    nodejs
    ast-grep
  ];
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
    rm -f \
      "$packageRoot/.attrs.json" \
      "$packageRoot/.attrs.sh" \
      "$packageRoot/env-vars"

    LAZYCODEX_PACKAGE_ROOT="$packageRoot" \
      "${nodeExecutable}" ${./script/prepareOmoCodexInstaller.mjs}

    commentCheckerRoot="$packageRoot/runtime"
    mkdir -p "$commentCheckerRoot"
    tar -xzf ${commentCheckerSrc} --strip-components=3 -C "$commentCheckerRoot" \
      package/vendor/${platform}/comment-checker

    find "$packageRoot/packages/omo-codex/plugin" -type d -name .github -prune -exec rm -rf {} +

    LAZYCODEX_PACKAGE_ROOT="$packageRoot" \
      "${nodeExecutable}" ${./script/pruneOmoGitBash.mjs}

    LAZYCODEX_PACKAGE_ROOT="$packageRoot" \
      "${nodeExecutable}" ${./script/hardenOmoCodexRuntime.mjs}

    pluginRoot="$packageRoot/packages/omo-codex/plugin"
    rm -rf \
      "$packageRoot/packages/git-bash-mcp" \
      "$packageRoot/dist/cli/install-codex/git-bash.d.ts" \
      "$pluginRoot/components/git-bash" \
      "$pluginRoot/components/rules/bundled-rules/windows-git-bash.md" \
      "$pluginRoot/components/rules/test/windows-git-bash-bundled-rule.test.ts" \
      "$pluginRoot/hooks/post-compact-resetting-git-bash-mcp-reminder.json" \
      "$pluginRoot/hooks/pre-tool-use-recommending-git-bash-mcp.json"

    LAZYCODEX_PLUGIN_ROOT="$packageRoot/packages/omo-codex/plugin" \
    LAZYCODEX_NODE_EXECUTABLE="${nodeExecutable}" \
    LAZYCODEX_SG_EXECUTABLE="${ast-grep}/bin/sg" \
      "${nodeExecutable}" ${./script/rewriteOmoPluginRuntimeJson.mjs}

    makeWrapper "${nodejs}/bin/node" "$out/bin/lazycodex-ai" \
      --add-flags "$packageRoot/packages/omo-codex/scripts/install-local.mjs" \
      --set LAZYCODEX_AI_NIX_SKIP_CACHE_NPM 1 \
      --set OMO_AST_GREP_SG_PATH "${ast-grep}/bin/sg" \
      --prefix PATH : "${nodePath}"

    runHook postInstall
  '';

  versionCheckProgram = "${placeholder "out"}/bin/lazycodex-ai";
  installCheck.extra = import ./installCheck.nix {
    inherit
      commentCheckerPin
      nodeExecutable
      packageRoot
      pin
      ;
  };

  meta = {
    homepage = "https://www.npmjs.com/package/lazycodex-ai";
    license = lib.licenses.sustainableUse;
    description = "Agent harness for complex codebases";
  };
}
