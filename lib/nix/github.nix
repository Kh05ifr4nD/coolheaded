{ base }:

let
  gitHubTagTarballUrl =
    {
      owner,
      repo,
      tag,
    }:
    "https://github.com/${owner}/${repo}/archive/refs/tags/${tag}.tar.gz";

  fetchGitHubTagTarball =
    {
      hash,
      owner,
      repo,
      tag,
    }:
    builtins.fetchTree {
      type = "tarball";
      url = gitHubTagTarballUrl { inherit owner repo tag; };
      narHash = hash;
    };

  mkGitHubReleaseBinaryPackage =
    {
      pname,
      owner,
      repo ? null,
      tag ? ({ version, ... }: "v${version}"),
      meta ? { },
      ...
    }@args:
    let
      repository = if repo == null then pname else repo;
    in
    base.mkReleaseBinaryPackage (
      removeAttrs args [
        "owner"
        "repo"
        "tag"
      ]
      // {
        url =
          { releaseAsset, version, ... }:
          "https://github.com/${owner}/${repository}/releases/download/${tag { inherit version; }}/${releaseAsset}";
        changelog =
          { version, ... }:
          "https://github.com/${owner}/${repository}/releases/tag/${tag { inherit version; }}";
        meta = {
          homepage = "https://github.com/${owner}/${repository}";
        }
        // meta;
      }
    );
in
{
  inherit fetchGitHubTagTarball gitHubTagTarballUrl mkGitHubReleaseBinaryPackage;
}
