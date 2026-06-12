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

  pyproject = pin: {
    project = {
      name = "specKitProject";
      inherit (pin) version;
      requires-python = ">=3.13,<3.14";
      dependencies = [ "specify-cli @ git+https://github.com/github/spec-kit.git@v${pin.version}" ];
    };
    tool.uv.extra-build-dependencies = {
      specify-cli = [ "hatchling" ];
    };
  };

  packageOverrides = _final: prev: {
    specify-cli = prev.specify-cli.overrideAttrs (oldAttrs: {
      patches = (oldAttrs.patches or [ ]) ++ [ ./patch/normalizeCopiedTreePermissions.patch ];
    });
  };

  versionCheckProgram = "${placeholder "out"}/bin/specify";
  versionCheckProgramArg = "--version";

  installCheck = ''
    export HOME="$PWD/check-home"
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

      assertFileExists sample/.specify/extensions/agent-context/agent-context-config.yml
      assertFileExists sample/.agents/skills/speckit-specify/SKILL.md
      (cd sample && "$out/bin/specify" integration list > /dev/null)
      test -w sample/.specify/extensions/agent-context/agent-context-config.yml \
        || failCheck "agent-context config is not writable"
    )
  '';

  meta = {
    mainProgram = "specify";
    homepage = "https://github.com/github/spec-kit";
    license = lib.licenses.mit;
    description = "Toolkit to help you get started with Spec-Driven Development";
    changelog = "https://github.com/github/spec-kit/releases";
  };
}
