{
  lib,
  package,
  pkgs,
  ...
}:

{
  zvecGrepRuntime =
    pkgs.runCommand "zvec-grep-runtime-check"
      {
        nativeBuildInputs = [
          pkgs.python3
        ]
        ++ lib.optional (pkgs.stdenv.hostPlatform.system == "aarch64-linux") pkgs.glibc.bin;
        __darwinAllowLocalNetworking = pkgs.stdenv.hostPlatform.isDarwin;
      }
      ''
        python3 -E ${./script/checkRuntime.py} ${package}
        touch "$out"
      '';
}
