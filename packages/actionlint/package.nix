{ lib, packageLib }:
packageLib.mkGitHubReleaseBinaryPackage {
  pname = "actionlint";
  owner = "rhysd";

  targets = packageLib.mkTargets [
    "darwin_arm64"
    "linux_arm64"
    "linux_amd64"
  ];
  asset = { version, target }: "actionlint_${version}_${target}.tar.gz";

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src"
    runHook postUnpack
  '';

  installCheck = {
    helpContains = "Usage: actionlint";
    extra = ''
      checkTestDir="$(mktemp -d)"
      mkdir -p "$checkTestDir/.github/workflows"
      cat > "$checkTestDir/.github/workflows/valid.yml" <<'EOF'
      name: valid
      on: push
      jobs:
        check:
          runs-on: ubuntu-latest
          steps:
            - run: echo ok
      EOF
      "$out/bin/actionlint" "$checkTestDir/.github/workflows/valid.yml"
    '';
  };

  meta = {
    homepage = "https://github.com/rhysd/actionlint";
    license = lib.licenses.mit;
    description = "Static checker for GitHub Actions workflow files";
  };
}
