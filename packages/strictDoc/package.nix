{
  lib,
  packageLib,
  python313,
}:

let
  pname = "strictdoc";
  sitePackages = "lib/python${python313.pythonVersion}/site-packages";
  preparePackage =
    name: package:
    package.overrideAttrs (oldAttrs: {
      postInstall = (oldAttrs.postInstall or "") + ''
        legalDirectory="$out/share/licenses/${name}"
        for legalFile in LICENSE NOTICE; do
          sourceFile="$out/${sitePackages}/$legalFile"
          if [ -f "$sourceFile" ]; then
            mkdir -p "$legalDirectory"
            mv "$sourceFile" "$legalDirectory/$legalFile"
          fi
        done

        rm -rf \
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
    strictdoc = preparePackage "strictdoc" prev.strictdoc;
    reqif = preparePackage "reqif" prev.reqif;
  };

  expectedExecutables = [ "strictdoc" ];
  versionCheckProgramArg = "version";

  meta = pin: {
    homepage = "https://strictdoc.readthedocs.io/en/stable/";
    license = lib.licenses.asl20;
    description = "Software for technical documentation and requirements management";
    mainProgram = "strictdoc";
    changelog = "https://github.com/strictdoc-project/strictdoc/releases/tag/${pin.version}";
  };
}
