{
  lib,
  bun,
  buildNpmPackage,
  fetchNpmDeps,
  jq,
  makeWrapper,
  nodejs-slim,
  packageLib,
}:
packageLib.mkNpmCliPackage {
  inherit
    buildNpmPackage
    fetchNpmDeps
    jq
    makeWrapper
    ;

  nodejs = nodejs-slim;
  runtimeInputs = [
    bun
    nodejs-slim
  ];

  pname = "magic-context";
  packageName = "@cortexkit/magic-context";
  cliPath = "dist/index.js";
  launcherNames = [ "magic-context" ];
  installItems = [
    "dist"
    "node_modules"
    "package.json"
  ];
  preVersionCheck = ''
    export HOME="$PWD/versionCheckHome"
    export XDG_CACHE_HOME="$PWD/versionCheckCache"
    export XDG_CONFIG_HOME="$PWD/versionCheckConfig"
    export XDG_DATA_HOME="$PWD/versionCheckData"
    export XDG_STATE_HOME="$PWD/versionCheckState"
    export TMPDIR="$PWD/versionCheckTmp"
    mkdir -p "$HOME" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$TMPDIR"
  '';
  versionCheckKeepEnvironment = [
    "HOME"
    "PATH"
    "TMPDIR"
    "XDG_CACHE_HOME"
    "XDG_CONFIG_HOME"
    "XDG_DATA_HOME"
    "XDG_STATE_HOME"
  ];
  installCheckExtra = ''
    installCheckHome="$PWD/installCheckHome"
    installCheckRoot="$PWD/installCheckXdg"
    installCheckTmp="$PWD/installCheckTmp"
    mkdir -p "$installCheckHome" "$installCheckRoot/cache" "$installCheckRoot/config" "$installCheckRoot/data" "$installCheckRoot/path" "$installCheckRoot/state" "$installCheckTmp"

    assertFileExists "$packageRoot/dist/index.js"
    jq -e '.name == "@cortexkit/magic-context" and .bin["magic-context"] == "dist/index.js"' "$packageRoot/package.json" > /dev/null \
      || failCheck "unexpected magic-context package metadata"

    runMagicContext() {
      HOME="$installCheckHome" \
        TMPDIR="$installCheckTmp" \
        XDG_CACHE_HOME="$installCheckRoot/cache" \
        XDG_CONFIG_HOME="$installCheckRoot/config" \
        XDG_DATA_HOME="$installCheckRoot/data" \
        XDG_STATE_HOME="$installCheckRoot/state" \
        "$out/bin/magic-context" "$@"
    }

    helpOutput="$(runMagicContext --help 2>&1)"
    case "$helpOutput" in
      *"Magic Context CLI"*) ;;
      *) failCheck "unexpected magic-context --help output" ;;
    esac
    case "$helpOutput" in
      *"setup"*) ;;
      *) failCheck "magic-context --help is missing setup" ;;
    esac
    case "$helpOutput" in
      *"doctor"*) ;;
      *) failCheck "magic-context --help is missing doctor" ;;
    esac
    case "$helpOutput" in
      *"--harness omp"*) ;;
      *) failCheck "magic-context --help is missing --harness omp" ;;
    esac

    versionOutput="$(runMagicContext --version 2>&1)"
    test "$versionOutput" = "$packageVersion" || failCheck "unexpected magic-context --version output: $versionOutput"

    if invalidHarnessOutput="$(runMagicContext setup --harness unsupported 2>&1)"; then
      failCheck "magic-context accepted an invalid --harness value"
    fi
    case "$invalidHarnessOutput" in
      *"Invalid --harness value: unsupported (expected opencode, pi, or omp)"*) ;;
      *) failCheck "unexpected invalid --harness output" ;;
    esac

    if missingOmpOutput="$(PATH="$installCheckRoot/path" runMagicContext setup --harness omp --dry-run 2>&1)"; then
      failCheck "magic-context accepted a missing OMP harness"
    fi
    case "$missingOmpOutput" in
      *"Magic Context setup (dry run)"*"Oh My Pi (OMP) not found"*) ;;
      *) failCheck "unexpected missing OMP setup output" ;;
    esac

    ompPackageRoot="$PWD/installCheckOmpPackage"
    ompFixtureState="$PWD/installCheckOmpFixtureState"
    ompInstallMarker="$PWD/installCheckOmpInstall"
    ompPluginRoot="$PWD/installCheckOmpPlugin"
    mkdir -p "$ompPackageRoot/dist" "$ompPluginRoot"
    cat > "$ompPackageRoot/package.json" <<'EOF'
    {"name":"@oh-my-pi/pi-coding-agent"}
    EOF
    cat > "$ompPluginRoot/package.json" <<'EOF'
    {"omp":{"extensions":["./dist/index.js"]}}
    EOF
    cat > "$ompPackageRoot/dist/cli.js" <<'EOF'
    import { existsSync, writeFileSync } from "node:fs";

    const args = process.argv.slice(2);
    if (args[0] === "--version") {
      console.log("omp/17.1.7");
    } else if (args.join(" ") === "plugin list --json") {
      console.log(JSON.stringify({
        npm: existsSync(process.env.OMP_FIXTURE_STATE)
          ? [{
            name: "@cortexkit/pi-magic-context",
            version: "0.36.1",
            enabled: true,
            path: process.env.OMP_FIXTURE_PLUGIN,
          }]
          : [],
      }));
    } else if (args.join(" ") === "plugin install @cortexkit/pi-magic-context") {
      const installerRuntime = Bun.spawnSync(["bun", "-e", "console.log(process.execPath)"]);
      if (installerRuntime.exitCode !== 0) process.exit(installerRuntime.exitCode);
      writeFileSync(process.env.OMP_FIXTURE_STATE, "installed");
      writeFileSync(
        process.env.OMP_INSTALL_MARKER,
        `''${process.execPath}\n''${installerRuntime.stdout.toString().trim()}\n''${args.join(" ")}`,
      );
    } else if (args.join(" ") === "config get compaction.enabled --json") {
      console.log('{"value":false}');
    } else if (args.join(" ") === "config get memory.backend --json") {
      console.log('{"value":"off"}');
    } else if (args.join(" ") === "config path") {
      console.log(`''${process.env.HOME}/.omp/agent`);
    } else {
      console.error(`unexpected OMP fixture arguments: ''${args.join(" ")}`);
      process.exit(1);
    }
    EOF
    if ! fixtureOmpOutput="$(
      PI_PACKAGE_DIR="$ompPackageRoot" \
        OMP_FIXTURE_PLUGIN="$ompPluginRoot" \
        OMP_FIXTURE_STATE="$ompFixtureState" \
        OMP_INSTALL_MARKER="$ompInstallMarker" \
        runMagicContext doctor --harness omp --force 2>&1
    )"; then
      failCheck "magic-context failed to repair a valid OMP fixture: $fixtureOmpOutput"
    fi
    assertFileExists "$ompInstallMarker"
    ompInstallInvocation="$(cat "$ompInstallMarker")"
    case "$ompInstallInvocation" in
      "${bun}/bin/bun"$'\n'"${bun}/bin/bun"$'\n'"plugin install @cortexkit/pi-magic-context") ;;
      *) failCheck "unexpected OMP plugin installation invocation: $ompInstallInvocation" ;;
    esac

    repairDbHelpOutput="$(runMagicContext doctor repair-db --help 2>&1)"
    case "$repairDbHelpOutput" in
      *"Usage: magic-context doctor repair-db"*) ;;
      *) failCheck "unexpected magic-context doctor repair-db --help output" ;;
    esac
    case "$repairDbHelpOutput" in
      *"SQLite .recover"*) ;;
      *) failCheck "magic-context doctor repair-db --help is missing SQLite .recover" ;;
    esac
  '';
  meta = {
    homepage = "https://github.com/cortexkit/magic-context#readme";
    license = lib.licenses.mit;
    description = "Unbounded context and self-managing memory for coding agents";
  };
}
