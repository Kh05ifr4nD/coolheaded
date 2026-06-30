{
  lib,
  packageLib,
  cacert,
  cmake,
  fetchPypi,
  ffmpeg_4,
  ffmpeg_6,
  libsndfile,
  python3,
  python3Packages,
  rdma-core,
  sox,
  tbb,
  cudaPackages,
  withAll ? false,
}:
let
  pname = "mineru";
  exposeGpuServerEntrypoints = withAll && packageLib.stdenv.hostPlatform.isLinux;

  pyproject =
    pin:
    packageLib.mkUvLockProject {
      dependencies = [ "mineru${lib.optionalString withAll "[all]"}==${pin.version}" ];
      extraBuildDependencies = {
        pylatexenc = [ "setuptools" ];
        xgrammar = [ "scikit_build_core" ];
      };
      python = python3;
    };

  packageOverrides =
    final: prev:
    let
      sitePackages = "lib/python${python3.pythonVersion}/site-packages";
      enableCudaPackageOverrides = exposeGpuServerEntrypoints;
      enableNvidiaWheelOverrides = withAll && packageLib.system == "x86_64-linux";
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
      nanobind_2_5 = python3Packages.nanobind.overridePythonAttrs (_oldAttrs: rec {
        version = "2.5.0";
        src = fetchPypi {
          pname = "nanobind";
          inherit version;
          hash = "sha256-zIQS6UrP+iCjaRkTgrzbtvv7MC5HXofKz/lRbVECOhU=";
        };
      });
    in
    {
      opencv-python-headless = prev.opencv-python-headless.overrideAttrs (oldAttrs: {
        postFixup = (oldAttrs.postFixup or "") + ''
          rm -rf "$out/${sitePackages}/cv2"
        '';
      });
      soundfile = prev.soundfile.overrideAttrs (oldAttrs: {
        postInstall = (oldAttrs.postInstall or "") + ''
          substituteInPlace "$out/${sitePackages}/soundfile.py" \
            --replace-fail "_find_library('sndfile')" \
              "'${libsndfile.out}/lib/libsndfile${packageLib.stdenv.hostPlatform.extensions.sharedLibrary}'"
        '';
      });
      xgrammar = prev.xgrammar.overrideAttrs (oldAttrs: {
        nativeBuildInputs = (oldAttrs.nativeBuildInputs or [ ]) ++ [
          cmake
          nanobind_2_5
        ];
        postPatch = (oldAttrs.postPatch or "") + ''
          if [ -f CMakeLists.txt ]; then
            substituteInPlace CMakeLists.txt \
              --replace-fail " -flto=auto" ""
            substituteInPlace cpp/nanobind/CMakeLists.txt \
              --replace-fail "nanobind_add_module(xgrammar_bindings LTO nanobind.cc)" \
                "nanobind_add_module(xgrammar_bindings nanobind.cc)"
          fi
        '';
        preBuild = (oldAttrs.preBuild or "") + ''
          export PYTHONPATH="${nanobind_2_5}/${sitePackages}:''${PYTHONPATH:-}"
          export CMAKE_PREFIX_PATH="${nanobind_2_5}/${sitePackages}/nanobind/cmake:''${CMAKE_PREFIX_PATH:-}"
        '';
      });
    }
    // lib.optionalAttrs enableCudaPackageOverrides {
      cupy-cuda12x = prev.cupy-cuda12x.overrideAttrs (oldAttrs: {
        buildInputs =
          (oldAttrs.buildInputs or [ ])
          ++ (with cudaPackages; [
            cuda_cudart
            cuda_nvrtc
            libcublas
            libcufft
            libcurand
            libcusolver
            libcusparse
            libcutensor
            nccl
          ]);
      });
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
        ];
      in
      {
        nvidia-cufile-cu12 = prev.nvidia-cufile-cu12.overrideAttrs (oldAttrs: {
          buildInputs = (oldAttrs.buildInputs or [ ]) ++ [ rdma-core ];
        });
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
          ];
          preFixup =
            (oldAttrs.preFixup or "")
            + "\n"
            + lib.concatMapStringsSep "\n" (path: "addAutoPatchelfSearchPath ${path}") torchNvidiaLibraries;
          autoPatchelfIgnoreMissingDeps = [ "libcuda.so.1" ];
        });
        xformers = prev.xformers.overrideAttrs (oldAttrs: {
          buildInputs = (oldAttrs.buildInputs or [ ]) ++ torchBuildInputs;
          preFixup = (oldAttrs.preFixup or "") + ''
            addAutoPatchelfSearchPath ${torchLibraryPath}
          '';
        });
      }
    );
in
packageLib.mkUvApplication {
  inherit packageOverrides pname pyproject;

  python = python3;
  extras = lib.optionals withAll [ "all" ];
  expectedExecutables = [
    "mineru"
    "mineru-api"
    "mineru-models-download"
    "mineru-openai-server"
    "mineru-router"
  ]
  ++ lib.optionals withAll [ "mineru-gradio" ]
  ++ lib.optionals exposeGpuServerEntrypoints [
    "mineru-lmdeploy-server"
    "mineru-vllm-server"
  ];

  postInstall = ''
    ${lib.optionalString (!withAll) ''
      rm -f "$out/bin/mineru-gradio"
    ''}

    ${lib.optionalString (!exposeGpuServerEntrypoints) ''
      rm -f "$out/bin/mineru-lmdeploy-server"
      rm -f "$out/bin/mineru-vllm-server"
    ''}
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
    "$out/bin/mineru-models-download" --help > /dev/null
    "$out/bin/mineru-openai-server" --help > /dev/null
    "$out/bin/mineru-router" --help > /dev/null

    ${lib.optionalString withAll ''
      "$out/bin/mineru-gradio" --help > /dev/null

      mineruPython="$(dirname "$(readlink "$out/bin/mineru")")/python"
      "$mineruPython" - <<'PY'
      import importlib

      for module in [
          "mineru.cli.vlm_server",
          "mineru.model.vlm.lmdeploy_server",
      ]:
          importlib.import_module(module)
      PY

      ${lib.optionalString exposeGpuServerEntrypoints ''
        test -x "$out/bin/mineru-lmdeploy-server" || failCheck "mineru-lmdeploy-server missing from Linux all variant"
        test -x "$out/bin/mineru-vllm-server" || failCheck "mineru-vllm-server missing from Linux all variant"
        "$mineruPython" - <<'PY'
        import importlib

        importlib.import_module("mineru.model.vlm.vllm_server")
        PY
      ''}

      ${lib.optionalString (!exposeGpuServerEntrypoints) ''
        test ! -e "$out/bin/mineru-lmdeploy-server" || failCheck "mineru-lmdeploy-server is not supported on this platform"
        test ! -e "$out/bin/mineru-vllm-server" || failCheck "mineru-vllm-server is not supported on this platform"
      ''}
    ''}

    ${lib.optionalString (!withAll) ''
      test ! -e "$out/bin/mineru-gradio" || failCheck "mineru-gradio requires optional all dependencies"
      test ! -e "$out/bin/mineru-lmdeploy-server" || failCheck "mineru-lmdeploy-server requires optional all dependencies"
      test ! -e "$out/bin/mineru-vllm-server" || failCheck "mineru-vllm-server requires optional all dependencies"
    ''}
  '';

  meta = pin: {
    homepage = "https://github.com/opendatalab/MinerU";
    license = lib.licenses.unfreeRedistributable;
    description = "Transforms complex documents like PDFs and Office docs into LLM-ready markdown/JSON for your Agentic workflows";
    changelog = "https://github.com/opendatalab/MinerU/releases/tag/mineru-${pin.version}-released";
  };
}
