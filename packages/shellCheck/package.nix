{ lib, packageLib }:
packageLib.mkGitHubReleaseBinaryPackage {
  pname = "shellcheck";
  owner = "koalaman";

  targets = packageLib.mkTargets [
    "darwin.aarch64"
    "linux.aarch64"
    "linux.x86_64"
  ];
  asset = { version, target }: "shellcheck-v${version}.${target}.tar.xz";

  installCheck = {
    helpContains = "Usage: shellcheck";
    extra = ''
      checkTestFile="$(mktemp)"
      printf '#!/bin/sh\nname=$1\necho $name\n' > "$checkTestFile"
      set +e
      checkOutput="$("$out/bin/shellcheck" "$checkTestFile" 2>&1)"
      checkStatus=$?
      set -e
      test "$checkStatus" -ne 0 || failCheck "expected shellcheck to reject unquoted variable"
      printf '%s\n' "$checkOutput" | grep -F 'SC2086' > /dev/null \
        || failCheck "missing expected shellcheck diagnostic"
    '';
  };

  meta = {
    homepage = "https://www.shellcheck.net";
    license = lib.licenses.gpl3Plus;
    description = "Static analysis tool for shell scripts";
  };
}
