{
  lib,
  pkgs,
  codex,
}:
# Codex 0.157.1 calls CFPreferencesAppSynchronize before config/read. Nix Darwin
# build users have no per-user cfprefsd and a /var/empty home, so that call
# fails. Real Home Manager users keep the packaged binary. The check runs a
# re-signed copy whose hardened runtime no longer blocks a test interpose that
# reports a successful preference sync.
lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
  codexAppServerDir="$TMPDIR/codex-app-server"
  mkdir -p "$codexAppServerDir"
  cat > "$codexAppServerDir/preference-sync.c" <<'EOF'
  #include <CoreFoundation/CoreFoundation.h>

  static Boolean nixCodexPreferenceSync(CFStringRef applicationID) {
    (void)applicationID;
    return true;
  }

  __attribute__((used)) static struct {
    const void *replacement;
    const void *replacee;
  } nixCodexPreferenceSyncInterpose __attribute__((section("__DATA,__interpose"))) = {
    (const void *)nixCodexPreferenceSync,
    (const void *)CFPreferencesAppSynchronize,
  };
  EOF
  clang -dynamiclib -framework CoreFoundation \
    -o "$codexAppServerDir/preference-sync.dylib" \
    "$codexAppServerDir/preference-sync.c"
  /usr/bin/codesign --force --sign - "$codexAppServerDir/preference-sync.dylib"
  cp ${codex}/libexec/codex/bin/codex "$codexAppServerDir/codex"
  chmod u+w "$codexAppServerDir/codex"
  /usr/bin/codesign --remove-signature "$codexAppServerDir/codex"
  /usr/bin/codesign --force --sign - "$codexAppServerDir/codex"
  cat > "$codexAppServerDir/codex-app-server" <<EOF
  #!/bin/bash
  export DYLD_INSERT_LIBRARIES="$codexAppServerDir/preference-sync.dylib"
  export PATH="${lib.makeBinPath [ pkgs.ripgrep ]}:\$PATH"
  exec "$codexAppServerDir/codex" "\$@"
  EOF
  chmod +x "$codexAppServerDir/codex-app-server"
  export CODEX_APP_SERVER_BIN="$codexAppServerDir/codex-app-server"
''
