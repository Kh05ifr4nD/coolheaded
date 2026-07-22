{ package, pkgs, ... }:

{
  strictDocHtmlExport = pkgs.runCommand "strictdoc-html-export-check" { } ''
    cat > minimal.sdoc <<'EOF'
    [DOCUMENT]
    TITLE: Minimal StrictDoc document

    [REQUIREMENT]
    UID: REQ-001
    TITLE: Minimal requirement
    STATEMENT: >>>
    The system shall export this requirement.
    <<<
    EOF

    ${package}/bin/strictdoc export minimal.sdoc \
      --formats=html \
      --output-dir output \
      --no-parallelization

    test -s output/html/index.html
    touch "$out"
  '';
}
