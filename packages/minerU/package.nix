{
  lib,
  packageLib,
  cacert,
  ffmpeg,
  libheif,
  python313,
  rdma-core,
  tbb,
  vulkan-loader,
  withTorch ? false,
  withFull ? false,
}:
if withTorch && withFull then
  throw "minerU withTorch and withFull are mutually exclusive"
else if (withTorch || withFull) && !packageLib.stdenv.hostPlatform.isLinux then
  throw "minerUTorch and minerUFull are Linux-only"
else
  let
    pname = "mineru";
    linuxAccelerated = withTorch || withFull;

    pyproject =
      pin:
      packageLib.mkUvLockProject {
        dependencies = [
          "mineru[torch,full]==${pin.version}"
          "mineru-vl-utils[mlx]; sys_platform == 'darwin' and platform_machine == 'arm64'"
        ];
        extraBuildDependencies = {
          jieba = [ "setuptools" ];
        };
        python = python313;
      };

    extras = lib.optionals withTorch [ "torch" ] ++ lib.optionals withFull [ "full" ];

    extraVenvDependencies = lib.optionalAttrs packageLib.stdenv.hostPlatform.isDarwin {
      mineru-vl-utils = [ "mlx" ];
    };

    distributionCheck =
      if packageLib.stdenv.hostPlatform.isDarwin then
        ''
          require("mlx-vlm")
          require("torch")
          require("torchvision")
          require("transformers")
          forbid("vllm")
          importlib.import_module("mlx.core")
        ''
      else if withFull then
        ''
          require("torch")
          require("torchvision")
          require("transformers")
          require("vllm")
          importlib.import_module("torch")
        ''
      else if withTorch then
        ''
          require("torch")
          require("torchvision")
          require("transformers")
          forbid("vllm")
          importlib.import_module("torch")
        ''
      else
        ''
          forbid("torch")
          forbid("vllm")
        '';

    sitePackages = "lib/python${python313.pythonVersion}/site-packages";

    cudaComponent =
      name:
      let
        versioned = builtins.match "(.*)-cu[0-9]+" name;
      in
      if versioned == null then name else builtins.head versioned;

    isNativeWheel =
      package:
      let
        src = package.src or null;
      in
      lib.isDerivation package
      && lib.isAttrs src
      && lib.hasSuffix ".whl" src.name
      && !lib.hasSuffix "-none-any.whl" src.name;

    linkNativeWheels =
      final: prev:
      lib.mapAttrs (
        name: package:
        if isNativeWheel package then
          package.overrideAttrs (
            oldAttrs:
            let
              providers = lib.filter (dependency: dependency.pname != package.pname && isNativeWheel dependency) (
                final.resolveVirtualEnv { ${name} = [ ]; }
              );
            in
            {
              buildInputs = (oldAttrs.buildInputs or [ ]) ++ providers;
              preFixup =
                (oldAttrs.preFixup or "")
                + lib.concatMapStrings (provider: ''
                  addAutoPatchelfSearchPath ${provider}/${sitePackages}
                '') providers;
              autoPatchelfIgnoreMissingDeps = (oldAttrs.autoPatchelfIgnoreMissingDeps or [ ]) ++ [
                "libcuda.so.1"
              ];
            }
          )
        else
          package
      ) prev;

    nativeOverrides =
      final: prev:
      let
        dependsOnTorch = oldAttrs: {
          passthru = oldAttrs.passthru // {
            dependencies = oldAttrs.passthru.dependencies // {
              torch = [ ];
            };
          };
        };

        overrideCudaComponent =
          component: overrideAttrs:
          lib.genAttrs (lib.filter (name: cudaComponent name == component) (lib.attrNames prev)) (
            name: prev.${name}.overrideAttrs overrideAttrs
          );
      in
      {
        mineru-llama-cpp = prev.mineru-llama-cpp.overrideAttrs (oldAttrs: {
          buildInputs = (oldAttrs.buildInputs or [ ]) ++ [ vulkan-loader ];
        });
        modelscope-hub = prev.modelscope-hub.overrideAttrs (oldAttrs: {
          postInstall = (oldAttrs.postInstall or "") + ''
            rm -f "$out/bin/modelscope" "$out/bin/ms"
          '';
        });
      }
      // lib.optionalAttrs packageLib.stdenv.hostPlatform.isDarwin {
        mlx = prev.mlx.overrideAttrs (oldAttrs: {
          preFixup = (oldAttrs.preFixup or "") + ''
            for library in "$out/${sitePackages}"/mlx/*.so; do
              install_name_tool -add_rpath "${final.mlx-metal}/${sitePackages}/mlx/lib" "$library"
            done
          '';
        });
      }
      // lib.optionalAttrs withFull {
        flashinfer-python = prev.flashinfer-python.overrideAttrs (oldAttrs: {
          postInstall = (oldAttrs.postInstall or "") + ''
            rm -f "$out/${sitePackages}/build_backend.py"
          '';
        });
        opencv-python-headless = prev.opencv-python-headless.overrideAttrs (oldAttrs: {
          postFixup = (oldAttrs.postFixup or "") + ''
            rm -rf "$out/${sitePackages}/cv2"
          '';
        });
        torch-c-dlpack-ext = prev.torch-c-dlpack-ext.overrideAttrs (oldAttrs: {
          postInstall = (oldAttrs.postInstall or "") + ''
            rm -f "$out/${sitePackages}/build_backend.py"
          '';
        });
      }
      // lib.optionalAttrs linuxAccelerated (
        {
          numba = prev.numba.overrideAttrs (oldAttrs: {
            buildInputs = (oldAttrs.buildInputs or [ ]) ++ [ tbb ];
          });
          torchaudio = prev.torchaudio.overrideAttrs dependsOnTorch;
          torchcodec = prev.torchcodec.overrideAttrs (
            oldAttrs:
            dependsOnTorch oldAttrs
            // {
              buildInputs = (oldAttrs.buildInputs or [ ]) ++ [
                ffmpeg
                libheif
              ];
              autoPatchelfIgnoreMissingDeps = (oldAttrs.autoPatchelfIgnoreMissingDeps or [ ]) ++ [
                "libav*"
                "libsw*"
              ];
            }
          );
        }
        // overrideCudaComponent "nvidia-cufile" (oldAttrs: {
          buildInputs = (oldAttrs.buildInputs or [ ]) ++ [ rdma-core ];
        })
        // overrideCudaComponent "nvidia-nvshmem" (oldAttrs: {
          autoPatchelfIgnoreMissingDeps = (oldAttrs.autoPatchelfIgnoreMissingDeps or [ ]) ++ [
            "libfabric.so.1"
            "libmlx5.so.1"
            "libmpi.so.40"
            "liboshmem.so.40"
            "libpmix.so.2"
            "libucp.so.0"
            "libucs.so.0"
          ];
        })
      );

    packageOverrides = lib.composeManyExtensions (
      lib.optional linuxAccelerated linkNativeWheels ++ [ nativeOverrides ]
    );
  in
  packageLib.mkUvApplication {
    inherit
      extraVenvDependencies
      extras
      packageOverrides
      pname
      pyproject
      ;

    python = python313;
    expectedExecutables = [
      "mineru"
      "mineru-api"
      "mineru-kit"
      "mineru-models-download"
      "mineru-openai-server"
      "mineru-router"
      "mineru-webui"
    ];

    preVersionCheck = ''
      export HOME="$PWD/versionCheckHome"
      export XDG_CACHE_HOME="$PWD/versionCheckCache"
      mkdir -p "$HOME" "$XDG_CACHE_HOME"
    '';

    installCheck = ''
      export HOME="$PWD/installCheckHome"
      export XDG_CACHE_HOME="$PWD/installCheckCache"
      export TMPDIR="$PWD/installCheckTmp"
      export SSL_CERT_FILE="${cacert}/etc/ssl/certs/ca-bundle.crt"
      export REQUESTS_CA_BUNDLE="$SSL_CERT_FILE"
      mkdir -p "$HOME" "$XDG_CACHE_HOME" "$TMPDIR"

      "$out/bin/mineru" --help > /dev/null
      "$out/bin/mineru-api" --help > /dev/null
      "$out/bin/mineru-kit" --help > /dev/null
      "$out/bin/mineru-models-download" --help > /dev/null
      "$out/bin/mineru-openai-server" --help > /dev/null
      "$out/bin/mineru-router" --help > /dev/null
      "$out/bin/mineru-webui" --help > /dev/null

      mineruPython="$(dirname "$(readlink -f "$out/bin/mineru")")/python"
      test -x "$mineruPython" || failCheck "venv python missing next to mineru"

      "$mineruPython" - <<'PY'
      import importlib
      import importlib.metadata


      def present(name: str) -> bool:
          try:
              importlib.metadata.version(name)
          except importlib.metadata.PackageNotFoundError:
              return False
          return True


      def require(name: str) -> None:
          if not present(name):
              raise SystemExit(f"missing distribution: {name}")


      def forbid(name: str) -> None:
          if present(name):
              raise SystemExit(f"unexpected distribution: {name}")


      require("mineru")
      require("mineru-llama-cpp")
      require("onnxruntime")
      ${distributionCheck}
      PY
    '';

    meta = pin: {
      homepage = "https://github.com/opendatalab/MinerU";
      license = {
        deprecated = false;
        free = false;
        fullName = "MinerU Open Source License";
        licenseType = "simple";
        redistributable = true;
        shortName = "minerU";
        spdxId = "LicenseRef-MinerU-Open-Source-License";
        url = "https://github.com/opendatalab/MinerU/blob/mineru-${pin.version}-released/LICENSE.md";
      };
      description = "A practical document parsing tool for converting PDF, OFD, EPUB, HTML, images, CSV, RTF, OOXML, and OpenDocument files into Markdown and JSON";
      changelog = "https://github.com/opendatalab/MinerU/releases/tag/mineru-${pin.version}-released";
      platforms =
        if linuxAccelerated then
          lib.filter (system: lib.hasSuffix "-linux" system) packageLib.supportedSystems
        else
          packageLib.supportedSystems;
    };
  }
