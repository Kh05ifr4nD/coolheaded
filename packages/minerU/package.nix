{
  lib,
  packageLib,
  cacert,
  ffmpeg_4,
  ffmpeg_6,
  python313,
  rdma-core,
  sox,
  tbb,
  vulkan-loader,
  cudaPackages,
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
    enableNvidiaWheelOverrides = linuxAccelerated && packageLib.system == "x86_64-linux";

    pyproject =
      pin:
      packageLib.mkUvLockProject {
        dependencies = [ "mineru[torch,full]==${pin.version}" ];
        extraBuildDependencies = {
          jieba = [ "setuptools" ];
        };
        python = python313;
      };

    extras = lib.optionals withTorch [ "torch" ] ++ lib.optionals withFull [ "full" ];

    distributionCheck =
      if packageLib.stdenv.hostPlatform.isDarwin then
        ''
          require("torch")
          require("torchvision")
          require("transformers")
          forbid("vllm")
        ''
      else if withFull then
        ''
          require("torch")
          require("torchvision")
          require("transformers")
          require("vllm")
        ''
      else if withTorch then
        ''
          require("torch")
          require("torchvision")
          require("transformers")
          forbid("vllm")
        ''
      else
        ''
          forbid("torch")
          forbid("vllm")
        '';

    packageOverrides =
      final: prev:
      let
        sitePackages = "lib/python${python313.pythonVersion}/site-packages";
        torchLibraryPath = "${final.torch}/${sitePackages}/torch/lib";
        torchBuildInputs = [
          cudaPackages.cuda_cudart
          final.torch
        ];
        vllmMissingDeps = [
          "libcuda.so.1"
        ]
        ++ lib.optionals (packageLib.system == "aarch64-linux") [
          "libc10_cuda.so"
          "libtorch_cuda.so"
        ];
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
      // lib.optionalAttrs withFull {
        nvidia-cutlass-dsl-libs-base = prev.nvidia-cutlass-dsl-libs-base.overrideAttrs {
          autoPatchelfIgnoreMissingDeps = [ "libcuda.so.1" ];
        };
        opencv-python-headless = prev.opencv-python-headless.overrideAttrs (oldAttrs: {
          postFixup = (oldAttrs.postFixup or "") + ''
            rm -rf "$out/${sitePackages}/cv2"
          '';
        });
        torch-c-dlpack-ext = prev.torch-c-dlpack-ext.overrideAttrs (oldAttrs: {
          buildInputs = (oldAttrs.buildInputs or [ ]) ++ torchBuildInputs;
          preFixup = (oldAttrs.preFixup or "") + ''
            addAutoPatchelfSearchPath ${torchLibraryPath}
          '';
        });
        xgrammar = prev.xgrammar.overrideAttrs (oldAttrs: {
          buildInputs = (oldAttrs.buildInputs or [ ]) ++ torchBuildInputs ++ [ final.apache-tvm-ffi ];
          preFixup = (oldAttrs.preFixup or "") + ''
            addAutoPatchelfSearchPath ${torchLibraryPath}
            addAutoPatchelfSearchPath ${final.apache-tvm-ffi}/${sitePackages}/tvm_ffi/lib
          '';
        });
      }
      // lib.optionalAttrs linuxAccelerated {
        numba = prev.numba.overrideAttrs (oldAttrs: {
          buildInputs = (oldAttrs.buildInputs or [ ]) ++ [ tbb ];
        });
        torchaudio = prev.torchaudio.overrideAttrs (oldAttrs: {
          buildInputs =
            (oldAttrs.buildInputs or [ ])
            ++ torchBuildInputs
            ++ [
              ffmpeg_4
              ffmpeg_6
              sox
            ];
          preFixup = (oldAttrs.preFixup or "") + ''
            addAutoPatchelfSearchPath ${torchLibraryPath}
          '';
          autoPatchelfIgnoreMissingDeps = [
            "libavcodec.so.59"
            "libavdevice.so.59"
            "libavfilter.so.8"
            "libavformat.so.59"
            "libavutil.so.57"
          ];
        });
        torchvision = prev.torchvision.overrideAttrs (oldAttrs: {
          buildInputs = (oldAttrs.buildInputs or [ ]) ++ torchBuildInputs;
          preFixup = (oldAttrs.preFixup or "") + ''
            addAutoPatchelfSearchPath ${torchLibraryPath}
          '';
        });
        vllm = prev.vllm.overrideAttrs (oldAttrs: {
          buildInputs = (oldAttrs.buildInputs or [ ]) ++ torchBuildInputs;
          preFixup = (oldAttrs.preFixup or "") + ''
            addAutoPatchelfSearchPath ${torchLibraryPath}
          '';
          autoPatchelfIgnoreMissingDeps = vllmMissingDeps;
        });
      }
      // lib.optionalAttrs enableNvidiaWheelOverrides (
        let
          nvidiaLibraryPath = package: component: "${package}/${sitePackages}/nvidia/${component}/lib";
          torchNvidiaLibraries = [
            (nvidiaLibraryPath final."nvidia-cublas-cu12" "cublas")
            (nvidiaLibraryPath final."nvidia-cuda-cupti-cu12" "cuda_cupti")
            (nvidiaLibraryPath final."nvidia-cuda-nvrtc-cu12" "cuda_nvrtc")
            (nvidiaLibraryPath final."nvidia-cuda-runtime-cu12" "cuda_runtime")
            (nvidiaLibraryPath final."nvidia-cudnn-cu12" "cudnn")
            (nvidiaLibraryPath final."nvidia-cufft-cu12" "cufft")
            (nvidiaLibraryPath final."nvidia-cufile-cu12" "cufile")
            (nvidiaLibraryPath final."nvidia-curand-cu12" "curand")
            (nvidiaLibraryPath final."nvidia-cusolver-cu12" "cusolver")
            (nvidiaLibraryPath final."nvidia-cusparse-cu12" "cusparse")
            (nvidiaLibraryPath final."nvidia-cusparselt-cu12" "cusparselt")
            (nvidiaLibraryPath final."nvidia-nccl-cu12" "nccl")
            (nvidiaLibraryPath final."nvidia-nvjitlink-cu12" "nvjitlink")
            (nvidiaLibraryPath final."nvidia-nvshmem-cu12" "nvshmem")
            (nvidiaLibraryPath final."nvidia-nvtx-cu12" "nvtx")
          ];
        in
        {
          nvidia-cufile-cu12 = prev.nvidia-cufile-cu12.overrideAttrs (oldAttrs: {
            buildInputs = (oldAttrs.buildInputs or [ ]) ++ [ rdma-core ];
          });
          nvidia-nvshmem-cu12 = prev.nvidia-nvshmem-cu12.overrideAttrs {
            autoPatchelfIgnoreMissingDeps = [
              "libfabric.so.1"
              "libmlx5.so.1"
              "libmpi.so.40"
              "liboshmem.so.40"
              "libpmix.so.2"
              "libucp.so.0"
              "libucs.so.0"
            ];
          };
          nvidia-cudnn-cu12 = prev.nvidia-cudnn-cu12.overrideAttrs (oldAttrs: {
            preFixup = (oldAttrs.preFixup or "") + ''
              addAutoPatchelfSearchPath ${nvidiaLibraryPath final."nvidia-cublas-cu12" "cublas"}
            '';
          });
          nvidia-cusolver-cu12 = prev.nvidia-cusolver-cu12.overrideAttrs (oldAttrs: {
            buildInputs = (oldAttrs.buildInputs or [ ]) ++ [
              final."nvidia-cublas-cu12"
              final."nvidia-cusparse-cu12"
              final."nvidia-nvjitlink-cu12"
            ];
            preFixup = (oldAttrs.preFixup or "") + ''
              addAutoPatchelfSearchPath ${nvidiaLibraryPath final."nvidia-cublas-cu12" "cublas"}
              addAutoPatchelfSearchPath ${nvidiaLibraryPath final."nvidia-cusparse-cu12" "cusparse"}
              addAutoPatchelfSearchPath ${nvidiaLibraryPath final."nvidia-nvjitlink-cu12" "nvjitlink"}
            '';
          });
          nvidia-cusparse-cu12 = prev.nvidia-cusparse-cu12.overrideAttrs (oldAttrs: {
            buildInputs = (oldAttrs.buildInputs or [ ]) ++ [ final."nvidia-nvjitlink-cu12" ];
            preFixup = (oldAttrs.preFixup or "") + ''
              addAutoPatchelfSearchPath ${nvidiaLibraryPath final."nvidia-nvjitlink-cu12" "nvjitlink"}
            '';
          });
          torch = prev.torch.overrideAttrs (oldAttrs: {
            buildInputs = (oldAttrs.buildInputs or [ ]) ++ [
              final."nvidia-cublas-cu12"
              final."nvidia-cuda-cupti-cu12"
              final."nvidia-cuda-nvrtc-cu12"
              final."nvidia-cuda-runtime-cu12"
              final."nvidia-cudnn-cu12"
              final."nvidia-cufft-cu12"
              final."nvidia-cufile-cu12"
              final."nvidia-curand-cu12"
              final."nvidia-cusolver-cu12"
              final."nvidia-cusparse-cu12"
              final."nvidia-cusparselt-cu12"
              final."nvidia-nccl-cu12"
              final."nvidia-nvjitlink-cu12"
              final."nvidia-nvshmem-cu12"
              final."nvidia-nvtx-cu12"
            ];
            preFixup =
              (oldAttrs.preFixup or "")
              + "\n"
              + lib.concatMapStringsSep "\n" (path: "addAutoPatchelfSearchPath ${path}") torchNvidiaLibraries;
            autoPatchelfIgnoreMissingDeps = [ "libcuda.so.1" ];
          });
        }
      );
  in
  packageLib.mkUvApplication {
    inherit
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
