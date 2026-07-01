{
  lib,
  packageLib,
  python314,
  runtimeShell,
}:

let
  pname = "openviking";
in
packageLib.mkUvApplication {
  inherit pname;

  python = python314;
  pyproject = pin: {
    project = {
      name = "openvikingProject";
      inherit (pin) version;
      requires-python = ">=3.14,<3.15";
      dependencies = [ "openviking==${pin.version}" ];
    };
    tool.uv.extra-build-dependencies = {
      sgmllib3k = [ "setuptools" ];
    };
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

  meta = pin: {
    homepage = "https://github.com/volcengine/OpenViking";
    license = lib.licenses.agpl3Only;
    description = "Open-source context database designed specifically for AI Agents";
    changelog = "https://github.com/volcengine/OpenViking/releases/tag/v${pin.version}";
  };
}
