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

    test -f sample/.specify/integrations/codex.manifest.json
    test -f sample/.specify/integrations/speckit.manifest.json
    test -f sample/.specify/workflows/speckit/workflow.yml
    test -f sample/.agents/skills/speckit-specify/SKILL.md
    (
      cd sample
      ${package}/bin/specify extension add git > /dev/null
      ${package}/bin/specify preset add lean > /dev/null
      ${package}/bin/specify integration list > /dev/null
      ${package}/bin/specify workflow list > /dev/null
    )
    test -f sample/.specify/extensions/git/extension.yml
    test -f sample/.specify/presets/lean/preset.yml

    shopt -s dotglob globstar nullglob
    for generatedPath in sample sample/**/*; do
      if [[ ! -w "$generatedPath" ]]; then
        echo "generated path is not writable: $generatedPath" >&2
        exit 1
      fi
    done

    touch "$out"
  '';
}
