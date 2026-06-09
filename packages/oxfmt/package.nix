{
  lib,
  stdenv,
  autoPatchelfHook,
  coreutils,
  packageLib,
}:
let
  pname = "oxfmt";
  targets = packageLib.rustTargetTriples;
  target = packageLib.releaseTarget pname targets;
  executableName = "oxfmt-${target}";
in
packageLib.mkGitHubReleaseBinaryPackage {
  inherit pname;
  inherit targets;
  owner = "oxc-project";
  repo = "oxc";
  tag = { version, ... }: "apps_v${version}";
  asset = { target, ... }: "oxfmt-${target}.tar.gz";

  nativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];

  preVersionCheck = ''
    version=0.53.0
  '';

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src"
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 ${executableName} "$out/libexec/oxfmt/oxfmt"
    mkdir -p "$out/bin"
    cat > "$out/bin/oxfmt" <<'EOF'
    #!${stdenv.shell}
    stdout="$(@mktemp@)"
    stderr="$(@mktemp@)"
    trap '@rm@ -f "$stdout" "$stderr"' EXIT

    set +e
    "@real@" "$@" >"$stdout" 2>"$stderr"
    status="$?"
    set -e

    if [ "$status" -eq 2 ] \
      && [ ! -s "$stdout" ] \
      && grep -Fxq 'Expected at least one target file. All matched files may have been excluded by ignore rules.' "$stderr"; then
      exit 0
    fi

    @cat@ "$stdout"
    @cat@ "$stderr" >&2
    exit "$status"
    EOF
    substituteInPlace "$out/bin/oxfmt" \
      --replace-fail '@cat@' "${coreutils}/bin/cat" \
      --replace-fail '@mktemp@' "${coreutils}/bin/mktemp" \
      --replace-fail '@real@' "$out/libexec/oxfmt/oxfmt" \
      --replace-fail '@rm@' "${coreutils}/bin/rm"
    chmod +x "$out/bin/oxfmt"
    runHook postInstall
  '';

  installCheck = {
    helpContains = "Usage: oxfmt";
    extra = ''
      checkTestDir="$(mktemp -d)"
      cat > "$checkTestDir/input.ts" <<'EOF'
      import { z } from "z";
      import { a } from "a";
      const value={a:1};
      EOF
      "$out/bin/oxfmt" "$checkTestDir/input.ts"
      "$out/bin/oxfmt" --check "$checkTestDir/input.ts"
      printf '{ x = 1; }\n' > "$checkTestDir/input.nix"
      "$out/bin/oxfmt" "$checkTestDir/input.nix"
    '';
  };

  meta = {
    license = lib.licenses.mit;
    description = "Formatter for JavaScript and TypeScript built on the Oxc compiler stack";
  };
}
