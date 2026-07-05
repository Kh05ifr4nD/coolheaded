{
  lib,
  package,
  pkgs,
  ...
}:

lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
  codexMinimal = package.override {
    withRipgrep = false;
    withBubblewrap = false;
  };
}
