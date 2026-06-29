{
  lib,
  python3,
  packageLib,
  runtimeShell,
}:
let
  pname = "semble";

  pin = builtins.fromJSON (builtins.readFile ./pin.json);

  workspaceSrc = packageLib.fetchGitHubTagTarball {
    owner = "MinishLab";
    repo = "semble";
    tag = "v${pin.version}";
    hash = pin.sourceHash;
  };

  pyproject = builtins.fromTOML (builtins.readFile "${workspaceSrc}/pyproject.toml");
in
packageLib.mkUvApplication {
  inherit pname pyproject;

  python = python3;
  extras = [ "mcp" ];
  workspaceRoot = workspaceSrc;

  packageOverrides = _final: prev: {
    semble = prev.semble.overrideAttrs (oldAttrs: {
      env = (oldAttrs.env or { }) // {
        PYTHONDONTWRITEBYTECODE = "1";
        SETUPTOOLS_SCM_PRETEND_VERSION = pin.version;
      };
    });
  };

  postInstall = ''
    semblePython="$(dirname "$(readlink "$out/bin/semble")")/python"
    cat > "$out/bin/semble-package-version" <<EOF
    #!${runtimeShell}
    exec "$semblePython" -c 'import importlib.metadata; print(importlib.metadata.version("semble"))'
    EOF
    chmod +x "$out/bin/semble-package-version"
    ln -s semble "$out/bin/semble-mcp"
  '';

  versionCheckProgram = "${placeholder "out"}/bin/semble-package-version";
  installCheck = ''
    "$out/bin/semble" --help > /dev/null
    "$out/bin/semble-mcp" --help > /dev/null
  '';

  meta = {
    homepage = "https://github.com/MinishLab/semble";
    license = lib.licenses.mit;
    description = "Fast and Accurate Code Search for Agents";
    changelog = "https://github.com/MinishLab/semble/releases/tag/v${pin.version}";
  };
}
