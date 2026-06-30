{
  cargo,
  lib,
  fetchFromGitHub,
  maturin,
  packageLib,
  python3,
  rustc,
  rustPlatform,
  runtimeShell,
  withBot ? false,
}:

let
  pname = "openviking";

  pin = builtins.fromJSON (builtins.readFile ./pin.json);

  workspaceSrc = packageLib.fetchGitHubTagTarball {
    owner = "volcengine";
    repo = "OpenViking";
    tag = "v${pin.version}";
    hash = pin.sourceHash;
  };

  src = fetchFromGitHub {
    owner = "volcengine";
    repo = "OpenViking";
    tag = "v${pin.version}";
    hash = pin.sourceHash;
  };

  pyproject = builtins.fromTOML (builtins.readFile "${workspaceSrc}/pyproject.toml");

  uvLock =
    let
      upstreamUvLock = builtins.fromTOML (builtins.readFile "${workspaceSrc}/uv.lock");
      openvikingSdkPackage = {
        name = "openviking-sdk";
        source.editable = "sdk/python";
        dependencies = [ { name = "httpx"; } ];
        metadata.requires-dist = [
          {
            name = "httpx";
            specifier = ">=0.25.0";
          }
        ];
      };
      patchOpenvikingPackage =
        package:
        if package.name or null == "openviking" then
          package
          // {
            dependencies = (package.dependencies or [ ]) ++ [ { name = "openviking-sdk"; } ];
            metadata = (package.metadata or { }) // {
              requires-dist = (package.metadata.requires-dist or [ ]) ++ [
                {
                  name = "openviking-sdk";
                  specifier = ">=0.1.1";
                }
              ];
            };
          }
        else
          package;
    in
    upstreamUvLock
    // {
      package = (map patchOpenvikingPackage upstreamUvLock.package) ++ [ openvikingSdkPackage ];
    };
in
packageLib.mkUvApplication {
  inherit pname pyproject uvLock;

  extras = lib.optionals withBot [ "bot" ];
  python = python3;
  workspaceRoot = workspaceSrc;

  packageOverrides = _final: prev: {
    "openviking-sdk" = prev."openviking-sdk".overrideAttrs (oldAttrs: {
      env = (oldAttrs.env or { }) // {
        SETUPTOOLS_SCM_PRETEND_VERSION_FOR_OPENVIKING_SDK = "0.1.2";
      };
    });
    openviking = prev.openviking.overrideAttrs (oldAttrs: {
      cargoDeps = rustPlatform.fetchCargoVendor {
        inherit src;
        hash = pin.cargoVendorHash;
      };
      env = (oldAttrs.env or { }) // {
        SETUPTOOLS_SCM_PRETEND_VERSION = pin.version;
      };
      nativeBuildInputs = (oldAttrs.nativeBuildInputs or [ ]) ++ [
        cargo
        maturin
        rustc
        rustPlatform.cargoSetupHook
      ];
      patches = (oldAttrs.patches or [ ]) ++ [
        ./patch/preserveFormatSecurityHardening.patch
        ./patch/useMaturinExecutable.patch
      ];
    });
  };

  postInstall = ''
    ${lib.optionalString (!withBot) ''
      rm -f "$out/bin/vikingbot"
    ''}

    openvikingPython="$(dirname "$(readlink "$out/bin/openviking")")/python"
    cat > "$out/bin/openviking-package-version" <<EOF
    #!${runtimeShell}
    exec "$openvikingPython" -c 'import importlib.metadata; print(importlib.metadata.version("openviking"))'
    EOF
    chmod +x "$out/bin/openviking-package-version"
  '';

  versionCheckProgram = "${placeholder "out"}/bin/openviking-package-version";
  preVersionCheck = ''
    export HOME="$PWD/versionCheckHome"
    mkdir -p "$HOME"
    "$out/bin/ov" language en > /dev/null
  '';
  versionCheckKeepEnvironment = [ "HOME" ];
  installCheck = ''
    export HOME="$PWD/installCheckHome"
    export XDG_CONFIG_HOME="$PWD/installCheckConfig"
    export TMPDIR="$PWD/installCheckTmp"
    mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$TMPDIR"
    "$out/bin/ov" language en > /dev/null

    "$out/bin/openviking" --help > /dev/null
    "$out/bin/ov" --help > /dev/null
    "$out/bin/openviking-server" --help > /dev/null

    ${lib.optionalString withBot ''
      "$out/bin/vikingbot" --help > /dev/null
    ''}

    ${lib.optionalString (!withBot) ''
      test ! -e "$out/bin/vikingbot" || failCheck "vikingbot requires the upstream bot extra"
    ''}
  '';

  meta = {
    homepage = "https://github.com/volcengine/OpenViking";
    license = lib.licenses.agpl3Only;
    description = "Open-source context database designed specifically for AI Agents";
    changelog = "https://github.com/volcengine/OpenViking/releases/tag/v${pin.version}";
  };
}
