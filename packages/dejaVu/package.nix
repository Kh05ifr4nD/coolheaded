{
  lib,
  makeWrapper,
  packageLib,
  git,
  sqlite,
  zstd,
}:
packageLib.mkGitHubReleaseBinaryPackage {
  pname = "deja-vu";
  mainProgram = "deja";
  owner = "vshulcz";

  targets = {
    aarch64-darwin = "darwin_arm64";
    aarch64-linux = "linux_arm64";
    x86_64-linux = "linux_amd64";
  };
  asset = { target, version }: "deja-vu_${version}_${target}.tar.gz";

  nativeBuildInputs = [ makeWrapper ];

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src"
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 deja "$out/bin/deja"
    install -Dm644 LICENSE "$out/share/licenses/deja-vu/LICENSE"
    runHook postInstall
  '';

  postFixup = ''
    wrapProgram "$out/bin/deja" --prefix PATH : ${
      lib.makeBinPath [
        git
        sqlite
        zstd
      ]
    }
  '';

  installCheck = {
    helpContains = "deja";
  };

  meta = {
    description = "Local MCP memory, session history search & coding agent handoff";
    license = lib.licenses.mit;
  };
}
