{
  lib,
  stdenv,
  autoPatchelfHook,
  makeWrapper,
  packageLib,
  tsgolint,
  withTypecheck ? true,
}:
let
  pname = "oxlint";
  targets = packageLib.rustTargetTriples;
  target = packageLib.releaseTarget pname targets;
  executableName = "oxlint-${target}";

  wrapperInputs = lib.optionals withTypecheck [ tsgolint ];
  wrapperNeeded = wrapperInputs != [ ];
  wrapperPath = lib.makeBinPath wrapperInputs;
  wrapperArgs = lib.optionals wrapperNeeded [
    "--prefix"
    "PATH"
    ":"
    wrapperPath
  ];
in
packageLib.mkGitHubReleaseBinaryPackage {
  inherit pname;
  inherit targets;
  owner = "oxc-project";
  repo = "oxc";
  tag = { version, ... }: "apps_v${version}";
  asset = { target, ... }: "oxlint-${target}.tar.gz";

  nativeBuildInputs = [
    makeWrapper
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];

  unpackPhase = ''
    runHook preUnpack

    mkdir oxlint
    tar -xzf "$src" -C oxlint

    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall

    packageRoot="$out/libexec/oxlint"
    mkdir -p "$packageRoot/bin" "$out/bin"
    install -Dm755 "oxlint/${executableName}" "$packageRoot/bin/oxlint"

    ${
      if wrapperNeeded then
        ''
          makeWrapper "$packageRoot/bin/oxlint" "$out/bin/oxlint" ${lib.escapeShellArgs wrapperArgs}
        ''
      else
        ''
          ln -s "$packageRoot/bin/oxlint" "$out/bin/oxlint"
        ''
    }

    runHook postInstall
  '';

  installCheck = {
    helpContains = "Usage: oxlint";
    extra = ''
      ${
        if wrapperNeeded then
          ''
            test ! -L "$out/bin/oxlint" || failCheck "expected wrapped oxlint launcher"
          ''
        else
          ''
            test -L "$out/bin/oxlint" || failCheck "expected oxlint launcher symlink"
            case "$(readlink "$out/bin/oxlint")" in
              "$out/libexec/oxlint/bin/oxlint") ;;
              "../libexec/oxlint/bin/oxlint") ;;
              *) failCheck "unexpected oxlint launcher symlink target" ;;
            esac
          ''
      }

      ${lib.optionalString withTypecheck ''
        typeAwareTestDir="$(mktemp -d)"
        cat > "$typeAwareTestDir/.oxlintrc.jsonc" <<'EOF'
        {
          "rules": {
            "typescript/no-unnecessary-type-assertion": "error"
          }
        }
        EOF
        cat > "$typeAwareTestDir/tsconfig.json" <<'EOF'
        {
          "compilerOptions": {
            "target": "es2024",
            "lib": ["ES2024", "DOM"],
            "module": "es2022",
            "strict": true,
            "skipLibCheck": true
          }
        }
        EOF
        cat > "$typeAwareTestDir/input.ts" <<'EOF'
        const str: string = "hello";
        const redundant = str as string;

        export {};
        EOF

        (
          cd "$typeAwareTestDir"
          set +e
          typeAwareOutput="$("$out/bin/oxlint" --type-aware input.ts 2>&1)"
          typeAwareStatus=$?
          set -e
          test "$typeAwareStatus" -ne 0 || failCheck "expected type-aware oxlint failure"
          printf '%s\n' "$typeAwareOutput" | grep -F "no-unnecessary-type-assertion" > /dev/null \
            || failCheck "missing expected type-aware diagnostic"
        )
      ''}
    '';
  };

  meta = {
    license = lib.licenses.mit;
    description = "Linter for Oxc";
  };
}
