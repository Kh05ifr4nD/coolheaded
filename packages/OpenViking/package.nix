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
in
packageLib.mkUvApplication {
  inherit pname pyproject;

  python = python3;
  workspaceRoot = workspaceSrc;

  packageOverrides = _final: prev: {
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
      patches = (oldAttrs.patches or [ ]) ++ [ ./patch/useMaturinExecutable.patch ];
    });
  };

  postInstall = ''
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
    "$out/bin/openviking" --help > /dev/null
    "$out/bin/ov" --help > /dev/null
    "$out/bin/openviking-server" --help > /dev/null
  '';

  meta = {
    homepage = "https://github.com/volcengine/OpenViking";
    license = lib.licenses.agpl3Only;
    description = "Open-source context database designed specifically for AI Agents";
    changelog = "https://github.com/volcengine/OpenViking/releases/tag/v${pin.version}";
  };
}
