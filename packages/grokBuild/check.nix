{ package, pkgs, ... }:

{
  grokBuildCompletions = pkgs.runCommand "grok-build-completions-check" { } ''
    mkdir -p "$TMPDIR/home"

    env -i HOME="$TMPDIR/home" \
      ${package}/bin/grok completions bash > completions.bash
    test -s completions.bash

    touch "$out"
  '';
}
