{
  lib,
  packageLib,
  python313,
}:

let
  pname = "strictdoc";
  sitePackages = "lib/python${python313.pythonVersion}/site-packages";
  removeSourceRootFiles =
    package:
    package.overrideAttrs (oldAttrs: {
      postInstall = (oldAttrs.postInstall or "") + ''
        rm -rf \
          "$out/${sitePackages}/LICENSE" \
          "$out/${sitePackages}/NOTICE" \
          "$out/${sitePackages}/README.md" \
          "$out/${sitePackages}/pyproject.toml" \
          "$out/${sitePackages}/tests"
      '';
    });
in
packageLib.mkUvApplication {
  inherit pname;

  python = python313;
  packageName = "strictdoc";

  pyproject =
    pin:
    packageLib.mkUvLockProject {
      dependencies = [ "strictdoc==${pin.version}" ];
      extraBuildDependencies.strictdoc = [ "hatchling" ];
      python = python313;
    };

  packageOverrides = _final: prev: {
    strictdoc = removeSourceRootFiles prev.strictdoc;
    reqif = removeSourceRootFiles prev.reqif;
  };

  expectedExecutables = [ "strictdoc" ];
  versionCheckProgramArg = "version";

  meta = pin: {
    homepage = "https://strictdoc.readthedocs.io/en/stable/";
    license = lib.licenses.asl20;
    description = "Open-source software for technical documentation and requirements management";
    mainProgram = "strictdoc";
    changelog = "https://github.com/strictdoc-project/strictdoc/releases/tag/${pin.version}";
  };
}
