{
  lib,
  python3,
  packageLib,
  runtimeShell,
}:
let
  pname = "semble";
in
packageLib.mkUvApplication {
  inherit pname;

  python = python3;
  extras = [ "mcp" ];
  expectedExecutables = [
    "semble"
    "semble-mcp"
    "semble-package-version"
  ];

  pyproject =
    pin:
    packageLib.mkUvLockProject {
      dependencies = [ "semble[mcp] @ git+https://github.com/MinishLab/semble.git@v${pin.version}" ];
      extraBuildDependencies.semble = [
        "setuptools"
        "setuptools-scm"
      ];
      python = python3;
      name = "sembleProject";
      version = pin.version;
    };

  packageOverrides = _final: prev: {
    semble = prev.semble.overrideAttrs (oldAttrs: {
      env = (oldAttrs.env or { }) // {
        PYTHONDONTWRITEBYTECODE = "1";
        SETUPTOOLS_SCM_PRETEND_VERSION = (packageLib.readPin ./pin.json).version;
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

  meta = pin: {
    homepage = "https://github.com/MinishLab/semble";
    license = lib.licenses.mit;
    description = "Fast and Accurate Code Search for Agents";
    changelog = "https://github.com/MinishLab/semble/releases/tag/v${pin.version}";
  };
}
