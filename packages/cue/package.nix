{ lib, packageLib }:
packageLib.mkGitHubReleaseBinaryPackage {
  pname = "cue";
  owner = "cue-lang";

  targets = packageLib.mkTargets [
    "darwin_arm64"
    "linux_arm64"
    "linux_amd64"
  ];
  asset = { version, target }: "cue_v${version}_${target}.tar.gz";

  unpackPhase = ''
    runHook preUnpack
    mkdir cue-release
    tar -xzf "$src" -C cue-release
    cd cue-release
    runHook postUnpack
  '';

  versionCheckProgramArg = "version";

  installCheck = {
    helpContains = "CUE makes it easy to validate data";
    helpFlag = "help";
    extra = ''
      checkTestDir="$(mktemp -d)"
      cat > "$checkTestDir/schema.cue" <<'EOF'
      #Schema: {
        name!: string
      }
      EOF
      cat > "$checkTestDir/data.json" <<'EOF'
      {
        "name": "coolheaded"
      }
      EOF
      "$out/bin/cue" vet "$checkTestDir/schema.cue" "$checkTestDir/data.json" -d '#Schema'
    '';
  };

  meta = {
    homepage = "https://cuelang.org/";
    license = lib.licenses.asl20;
    description = "Validate and define text-based and dynamic configuration";
  };
}
