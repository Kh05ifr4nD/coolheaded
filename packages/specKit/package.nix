{
  lib,
  packageLib,
  python313,
}:

let
  pname = "spec-kit";
in
packageLib.mkUvApplication {
  inherit pname;

  python = python313;
  packageName = "specify-cli";

  pyproject =
    pin:
    packageLib.mkUvLockProject {
      dependencies = [ "specify-cli @ git+https://github.com/github/spec-kit.git@v${pin.version}" ];
      extraBuildDependencies.specify-cli = [ "hatchling" ];
      python = python313;
      name = "specKitProject";
      version = pin.version;
    };

  packageOverrides = _final: prev: {
    specify-cli = prev.specify-cli.overrideAttrs (oldAttrs: {
      patches = (oldAttrs.patches or [ ]) ++ [ ./patch/normalizeCopiedTreePermissions.patch ];
    });
  };

  expectedExecutables = [ "specify" ];
  versionCheckProgram = "${placeholder "out"}/bin/specify";

  installCheck = ''
    export HOME="$PWD/installCheckHome"
    mkdir -p "$HOME"

    "$out/bin/specify" --help > /dev/null

    checkDir="$(mktemp -d)"
    (
      cd "$checkDir"
      "$out/bin/specify" init sample \
        --integration codex \
        --integration-options='--skills' \
        --ignore-agent-tools \
        --script sh

      assertFileExists sample/.specify/integrations/codex.manifest.json
      assertFileExists sample/.specify/integrations/speckit.manifest.json
      assertFileExists sample/.specify/workflows/speckit/workflow.yml
      assertFileExists sample/.agents/skills/speckit-specify/SKILL.md
      (cd sample && "$out/bin/specify" integration list > /dev/null)
      (cd sample && "$out/bin/specify" workflow list > /dev/null)

      shopt -s dotglob globstar nullglob
      for generatedPath in sample sample/**/*; do
        test -w "$generatedPath" \
          || failCheck "generated path is not writable: $generatedPath"
      done
    )
  '';

  meta = pin: {
    homepage = "https://github.com/github/spec-kit";
    license = lib.licenses.mit;
    description = "Toolkit to help you get started with Spec-Driven Development";
    mainProgram = "specify";
    changelog = "https://github.com/github/spec-kit/releases/tag/v${pin.version}";
  };
}
