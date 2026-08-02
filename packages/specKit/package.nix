{
  lib,
  packageLib,
  python313,
  runtimeShell,
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

  postInstall = ''
        mkdir -p "$out/libexec/spec-kit"
        mv "$out/bin/specify" "$out/libexec/spec-kit/specify"
        cat > "$out/bin/specify" <<'EOF'
    #!${runtimeShell}
    set -u

    managedRoot="$PWD"
    command=""
    skipOptionValue=0
    for argument in "$@"; do
      if [ -z "$command" ]; then
        case "$argument" in
          init) command="init" ;;
          --*) ;;
          *) command="other" ;;
        esac
        continue
      fi
      if [ "$command" != "init" ]; then
        continue
      fi
      if [ "$skipOptionValue" -eq 1 ]; then
        skipOptionValue=0
        continue
      fi
      case "$argument" in
        --here)
          managedRoot="$PWD"
          ;;
        --script|--preset|--integration|--integration-options)
          skipOptionValue=1
          ;;
        --*)
          ;;
        *)
          managedRoot="$argument"
          break
          ;;
      esac
    done
    case "$managedRoot" in
      /*) ;;
      *) managedRoot="$PWD/$managedRoot" ;;
    esac

    "${placeholder "out"}/libexec/spec-kit/specify" "$@"
    status=$?
    normalizationStatus=0
    for generatedRoot in "$managedRoot/.specify" "$managedRoot/.agents"; do
      if [ -e "$generatedRoot" ] && ! chmod -R u+rwX "$generatedRoot"; then
        normalizationStatus=1
      fi
    done
    if [ "$status" -ne 0 ]; then
      exit "$status"
    fi
    exit "$normalizationStatus"
    EOF
        chmod 0755 "$out/bin/specify"
  '';

  expectedExecutables = [ "specify" ];
  versionCheckProgram = "${placeholder "out"}/bin/specify";

  installCheck = ''
    export HOME="$PWD/installCheckHome"
    mkdir -p "$HOME"

    "$out/bin/specify" --help > /dev/null

    checkDir="$(mktemp -d)"
    (
      cd "$checkDir"
      samplePath="$checkDir/sample"
      "$out/bin/specify" init "$samplePath" \
        --integration codex \
        --integration-options='--skills' \
        --ignore-agent-tools \
        --script sh

      assertFileExists "$samplePath/.specify/integrations/codex.manifest.json"
      assertFileExists "$samplePath/.specify/integrations/speckit.manifest.json"
      assertFileExists "$samplePath/.specify/workflows/speckit/workflow.yml"
      assertFileExists "$samplePath/.agents/skills/speckit-specify/SKILL.md"
      (cd "$samplePath" && "$out/bin/specify" integration list > /dev/null)
      (cd "$samplePath" && "$out/bin/specify" workflow list > /dev/null)

      shopt -s dotglob globstar nullglob
      for generatedPath in "$samplePath" "$samplePath"/**/*; do
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
