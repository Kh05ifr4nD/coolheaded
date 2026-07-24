{ package, pkgs, ... }:

{
  specKitGeneratedTree = pkgs.runCommand "spec-kit-generated-tree-check" { } ''
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"

    ${package}/bin/specify init sample \
      --integration codex \
      --integration-options='--skills' \
      --ignore-agent-tools \
      --script sh \
      > /dev/null

    (
      cd sample
      ${package}/bin/specify extension add git > /dev/null
      ${package}/bin/specify preset add lean > /dev/null
    )
    test -f sample/.specify/extensions/git/extension.yml
    test -f sample/.specify/presets/lean/preset.yml

    touch "$out"
  '';
}
