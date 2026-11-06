{ package, pkgs, ... }:

{
  zvecGrepRuntime =
    pkgs.runCommand "zvec-grep-runtime-check"
      {
        nativeBuildInputs = [ pkgs.python3 ];
        __darwinAllowLocalNetworking = pkgs.stdenv.hostPlatform.isDarwin;
      }
      ''
        python3 -E ${./script/checkRuntime.py} ${package}
        touch "$out"
      '';
}
