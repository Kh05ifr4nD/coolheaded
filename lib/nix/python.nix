{
  base,
  callPackage,
  callPackages,
  lib,
  pyprojectBuildSystems,
  pyprojectNix,
  uv2nix,
}:

let
  inherit (callPackages pyprojectNix.build.util { }) mkApplication;

  lockInputProjectName = "coolheaded-lock-input";
  lockInputProjectVersion = "0";

  pythonRequirement =
    python:
    let
      pythonMinorVersion = python.pythonVersion;
      match = builtins.match "([0-9]+)\\.([0-9]+)" pythonMinorVersion;
    in
    if match == null then
      throw "Invalid Python minor version: ${pythonMinorVersion}"
    else
      ">=${pythonMinorVersion}";

  mkUvLockProject =
    {
      dependencies,
      python,
      extraBuildDependencies ? { },
      name ? lockInputProjectName,
      optionalDependencies ? { },
      version ? lockInputProjectVersion,
    }:
    {
      project = {
        inherit dependencies name version;
        requires-python = pythonRequirement python;
      }
      // lib.optionalAttrs (optionalDependencies != { }) {
        optional-dependencies = optionalDependencies;
      };
    }
    // lib.optionalAttrs (extraBuildDependencies != { }) {
      tool.uv.extra-build-dependencies = extraBuildDependencies;
    };

  mkUvPythonSet =
    {
      python,
      pyproject,
      packageOverrides ? (_final: _prev: { }),
      sourcePreference ? "wheel",
      workspaceRoot ? base.packageDirectory,
    }:
    let
      workspace = uv2nix.lib.workspace.loadWorkspace { inherit pyproject workspaceRoot; };
      overlay = workspace.mkPyprojectOverlay { inherit sourcePreference; };
    in
    (callPackage pyprojectNix.build.packages { inherit python; }).overrideScope (
      lib.composeManyExtensions [
        pyprojectBuildSystems.overlays.wheel
        overlay
        packageOverrides
      ]
    );

  mkUvApplication =
    {
      pname,
      python,
      pyproject,
      meta,
      doInstallCheck ? base.canExecute,
      extras ? [ ],
      installCheck ? "",
      nativeInstallCheckInputs ? [ ],
      packageName ? pname,
      packageOverrides ? (_final: _prev: { }),
      pinPath ? base.defaultPinPath,
      postInstall ? "",
      preVersionCheck ? "",
      sourcePreference ? "wheel",
      versionCheckKeepEnvironment ? [ ],
      versionCheckProgram ? "${placeholder "out"}/bin/${pname}",
      versionCheckProgramArg ? "--version",
      workspaceRoot ? base.packageDirectory,
    }:
    let
      pin = base.readPin pinPath;
      resolve = value: if builtins.isFunction value then value pin else value;
      pythonSet = mkUvPythonSet {
        inherit
          packageOverrides
          python
          sourcePreference
          workspaceRoot
          ;
        pyproject = resolve pyproject;
      };
    in
    (mkApplication {
      venv = pythonSet.mkVirtualEnv "${pname}-env" (
        builtins.listToAttrs [
          {
            name = packageName;
            value = extras;
          }
        ]
      );
      package = pythonSet.${packageName};
    }).overrideAttrs
      (
        oldAttrs:
        {
          inherit pname;
          inherit (pin) version;

          strictDeps = true;
          __structuredAttrs = true;

          nativeInstallCheckInputs =
            (oldAttrs.nativeInstallCheckInputs or [ ]) ++ [ base.versionCheckHook ] ++ nativeInstallCheckInputs;

          postInstall = (oldAttrs.postInstall or "") + postInstall;

          inherit
            doInstallCheck
            versionCheckKeepEnvironment
            versionCheckProgram
            versionCheckProgramArg
            ;
          installCheckPhase = base.mkInstallCheckPhase {
            executable = versionCheckProgram;
            extra = installCheck;
          };

          meta = {
            mainProgram = pname;
            platforms = base.supportedSystems;
            sourceProvenance = with lib.sourceTypes; [ binaryNativeCode ];
          }
          // resolve meta;
        }
        // lib.optionalAttrs (preVersionCheck != "") { inherit preVersionCheck; }
      );
in
{
  inherit
    mkUvApplication
    mkUvLockProject
    mkUvPythonSet
    pythonRequirement
    ;
}
