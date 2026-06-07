{ lib, packageLib }:
packageLib.mkGitHubReleaseBinaryPackage {
  pname = "shfmt";
  owner = "mvdan";
  repo = "sh";

  targets = packageLib.mkTargets [
    "darwin_arm64"
    "linux_arm64"
    "linux_amd64"
  ];
  asset = { version, target }: "shfmt_v${version}_${target}";

  dontUnpack = true;

  installCheck = {
    helpContains = "usage: shfmt";
    extra = ''
      checkTestDir="$(mktemp -d)"
      unformattedFile="$checkTestDir/input.sh"
      formattedFile="$checkTestDir/formatted.sh"
      printf 'if   true; then echo ok; fi\n' > "$unformattedFile"
      set +e
      diffOutput="$("$out/bin/shfmt" -d "$unformattedFile" 2>&1)"
      diffStatus=$?
      set -e
      test "$diffStatus" -ne 0 || failCheck "expected shfmt diff status for unformatted input"
      printf '%s\n' "$diffOutput" | grep -q '^--- ' \
        || failCheck "expected shfmt diff for unformatted input"
      "$out/bin/shfmt" -w "$unformattedFile"
      "$out/bin/shfmt" -d "$unformattedFile" > "$formattedFile"
      test ! -s "$formattedFile" || failCheck "shfmt left formatted input dirty"
    '';
  };

  meta = {
    license = lib.licenses.bsd3;
    description = "Shell parser, formatter, and interpreter";
  };
}
