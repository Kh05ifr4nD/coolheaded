{
  lib,
  pkgs,
  bun2nix,
  pyprojectBuildSystems,
  pyprojectNix,
  uv2nix,
}:

let
  packages = import ./packageSet.nix {
    inherit
      lib
      pkgs
      bun2nix
      pyprojectBuildSystems
      pyprojectNix
      uv2nix
      ;
  };
in
packages
// {
  codeReviewGraphWithAll = packages.codeReviewGraph.override { withAll = true; };
  codeReviewGraphWithCommunities = packages.codeReviewGraph.override { withCommunities = true; };
  codeReviewGraphWithEmbeddings = packages.codeReviewGraph.override { withEmbeddings = true; };
  codeReviewGraphWithEnrichment = packages.codeReviewGraph.override { withEnrichment = true; };
  codeReviewGraphWithEval = packages.codeReviewGraph.override { withEval = true; };
  codeReviewGraphWithGoogleEmbeddings = packages.codeReviewGraph.override {
    withGoogleEmbeddings = true;
  };
  codeReviewGraphWithWiki = packages.codeReviewGraph.override { withWiki = true; };
  codexWithoutRipgrep = packages.codex.override { withRipgrep = false; };
  oxlintWithoutTypecheck = packages.oxlint.override { withTypecheck = false; };
}
// lib.optionalAttrs (pkgs.stdenv.hostPlatform.system == "aarch64-linux") {
  mineruWithAll = packages.mineru.override { withAll = true; };
}
// lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
  codexMinimal = packages.codex.override {
    withRipgrep = false;
    withBubblewrap = false;
  };
  codexWithoutBubblewrap = packages.codex.override { withBubblewrap = false; };
}
