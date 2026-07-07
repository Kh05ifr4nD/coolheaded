{
  lib,
  stdenv,
  autoPatchelfHook,
  makeWrapper,
  packageLib,
}:
packageLib.mkGitHubReleaseBinaryPackage {
  pname = "fff";
  owner = "dmtrKovalenko";

  targets = packageLib.rustTargetTriples;
  asset = { target, ... }: "fff-mcp-${target}";
  dontUnpack = true;
  mainProgram = "fff-mcp";

  nativeBuildInputs = [
    makeWrapper
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];

  installPhase = ''
    runHook preInstall

    packageRoot="$out/libexec/fff"
    install -Dm755 "$src" "$packageRoot/bin/fff-mcp"
    makeWrapper "$packageRoot/bin/fff-mcp" "$out/bin/fff-mcp" \
      --add-flags --no-update-check

    runHook postInstall
  '';

  installCheck = {
    helpContains = "FFF MCP Server";
    extra = ''
      test ! -L "$out/bin/fff-mcp" || failCheck "expected wrapped fff-mcp launcher"
      grep -F -- '--no-update-check' "$out/bin/fff-mcp" > /dev/null \
        || failCheck "fff-mcp wrapper must disable upstream update checks"
      assertExecutableExists "$out/libexec/fff/bin/fff-mcp"
      PATH=/definitely-empty HOME="$PWD/installCheckHome" "$out/bin/fff-mcp" --healthcheck
      "$out/bin/fff-mcp" --healthcheck
    '';
  };

  meta = {
    license = lib.licenses.mit;
    description = "Fast file search toolkit for AI agents";
  };
}
