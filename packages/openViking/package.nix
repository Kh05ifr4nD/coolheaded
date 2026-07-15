{
  cargo,
  cmake,
  lib,
  fetchFromGitHub,
  maturin,
  ninja,
  packageLib,
  python313,
  rustc,
  rustPlatform,
  runtimeShell,
  withAll ? false,
}:

let
  pname = "openviking";

  pin = builtins.fromJSON (builtins.readFile ./pin.json);
  sourceRef =
    if pin.version == "0.4.9" then
      # Upstream deleted and recreated v0.4.9; retain its original release head.
      "cbfb387dc78a73c63121ca926eded6ae92760c09"
    else
      "refs/tags/v${pin.version}";

  workspaceSrc = builtins.fetchTree {
    type = "tarball";
    url = "https://github.com/volcengine/OpenViking/archive/${sourceRef}.tar.gz";
    narHash = pin.sourceHash;
  };

  src = fetchFromGitHub {
    owner = "volcengine";
    repo = "OpenViking";
    rev = sourceRef;
    hash = pin.sourceHash;
  };

  pyproject = builtins.fromTOML (builtins.readFile "${workspaceSrc}/pyproject.toml");

  uvLock =
    let
      upstreamUvLock = builtins.fromTOML (builtins.readFile "${workspaceSrc}/uv.lock");
      hasPackageNamed =
        packageName: builtins.any (package: package.name or null == packageName) upstreamUvLock.package;
      hasDependencyNamed =
        package: dependencyName:
        builtins.any (dependency: dependency.name or null == dependencyName) (package.dependencies or [ ]);
      hasRequiresDistNamed =
        package: dependencyName:
        builtins.any (dependency: dependency.name or null == dependencyName) (
          package.metadata.requires-dist or [ ]
        );
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
            dependencies =
              (package.dependencies or [ ])
              ++ lib.optionals (!(hasDependencyNamed package "openviking-sdk")) [ { name = "openviking-sdk"; } ];
            metadata = (package.metadata or { }) // {
              requires-dist =
                (package.metadata.requires-dist or [ ])
                ++ lib.optionals (!(hasRequiresDistNamed package "openviking-sdk")) [
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
      package =
        map patchOpenvikingPackage upstreamUvLock.package
        ++ lib.optionals (!(hasPackageNamed "openviking-sdk")) [ openvikingSdkPackage ];
    };
in
packageLib.mkUvApplication {
  inherit pname pyproject uvLock;

  extras = lib.optionals withAll [
    "bot"
    "local-embed"
  ];
  python = python313;
  workspaceRoot = workspaceSrc;

  packageOverrides = final: prev: {
    fusepy = prev.fusepy.overrideAttrs (oldAttrs: {
      nativeBuildInputs = (oldAttrs.nativeBuildInputs or [ ]) ++ [ prev.setuptools ];
    });
    "llama-cpp-python" = prev."llama-cpp-python".overrideAttrs (oldAttrs: {
      cmakeFlags = (oldAttrs.cmakeFlags or [ ]) ++ [ (lib.cmakeBool "GGML_NATIVE" false) ];
      dontUseCmakeConfigure = true;
      nativeBuildInputs =
        (oldAttrs.nativeBuildInputs or [ ])
        ++ [
          cmake
          ninja
        ]
        ++ final.resolveBuildSystem {
          pathspec = [ ];
          pyproject-metadata = [ ];
          scikit-build-core = [ ];
        };
    });
    "openviking-sdk" = prev."openviking-sdk".overrideAttrs (oldAttrs: {
      env = (oldAttrs.env or { }) // {
        SETUPTOOLS_SCM_PRETEND_VERSION_FOR_OPENVIKING_SDK = "0.1.2";
      };
    });
    sgmllib3k = prev.sgmllib3k.overrideAttrs (oldAttrs: {
      nativeBuildInputs = (oldAttrs.nativeBuildInputs or [ ]) ++ [ prev.setuptools ];
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

  expectedExecutables = [
    "openviking"
    "openviking-package-version"
    "openviking-server"
    "ov"
  ]
  ++ lib.optionals withAll [ "vikingbot" ];

  postInstall = ''
    ${lib.optionalString (!withAll) ''
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

    ${lib.optionalString withAll ''
      openvikingPython="$(dirname "$(readlink "$out/bin/openviking")")/python"
      if ! "$openvikingPython" -c \
        'import diskcache, jinja2, numpy, typing_extensions; from llama_cpp import Llama'; then
        failCheck "OpenViking Full local embedding Python closure is incomplete"
      fi

      "$out/bin/vikingbot" --help > /dev/null
    ''}

    ${lib.optionalString (!withAll) ''
      openvikingPython="$(dirname "$(readlink "$out/bin/openviking")")/python"
      "$openvikingPython" -c \
        'from importlib.util import find_spec; assert find_spec("llama_cpp") is None'
      test ! -e "$out/bin/vikingbot" || failCheck "vikingbot requires OpenViking Full"
    ''}
  '';

  meta = {
    homepage = "https://github.com/volcengine/OpenViking";
    license = lib.licenses.agpl3Only;
    description = "Open-source context database designed specifically for AI Agents";
    changelog = "https://github.com/volcengine/OpenViking/releases/tag/v${pin.version}";
  };
}
