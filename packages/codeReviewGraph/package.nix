{
  lib,
  packageLib,
  python314,
  libfabric,
  openmpi,
  pmix,
  rdma-core,
  ucx,
  withAll ? false,
  withCommunities ? false,
  withEmbeddings ? false,
  withEnrichment ? false,
  withEval ? false,
  withGoogleEmbeddings ? false,
  withWiki ? false,
}:
let
  pname = "code-review-graph";

  extras = lib.unique (
    lib.optionals withAll [
      "all"
      "google-embeddings"
    ]
    ++ lib.optionals withCommunities [ "communities" ]
    ++ lib.optionals withEmbeddings [ "embeddings" ]
    ++ lib.optionals withEnrichment [ "enrichment" ]
    ++ lib.optionals withEval [ "eval" ]
    ++ lib.optionals withGoogleEmbeddings [ "google-embeddings" ]
    ++ lib.optionals withWiki [ "wiki" ]
  );

  pyproject = pin: {
    project = {
      name = "codeReviewGraphProject";
      inherit (pin) version;
      requires-python = ">=3.14,<3.15";
      dependencies = [
        "${pname}[all]==${pin.version}"
        "${pname}[communities]==${pin.version}"
        "${pname}[embeddings]==${pin.version}"
        "${pname}[enrichment]==${pin.version}"
        "${pname}[eval]==${pin.version}"
        "${pname}[google-embeddings]==${pin.version}"
        "${pname}[wiki]==${pin.version}"
      ];
    };
    tool.uv.extra-build-dependencies = {
      watchdog = [ "setuptools" ];
    };
  };

  packageOverrides =
    final: prev:
    let
      sitePackages = "lib/python${python314.pythonVersion}/site-packages";
      nvidiaCu13LibraryPath = package: "${package}/${sitePackages}/nvidia/cu13/lib";
      nvidiaLibraryPath = package: component: "${package}/${sitePackages}/nvidia/${component}/lib";
      torchNvidiaLibraries = [
        (nvidiaCu13LibraryPath final.nvidia-cublas)
        (nvidiaCu13LibraryPath final.nvidia-cuda-cupti)
        (nvidiaCu13LibraryPath final.nvidia-cuda-nvrtc)
        (nvidiaCu13LibraryPath final.nvidia-cuda-runtime)
        (nvidiaLibraryPath final."nvidia-cudnn-cu13" "cudnn")
        (nvidiaCu13LibraryPath final.nvidia-cufft)
        (nvidiaCu13LibraryPath final.nvidia-cufile)
        (nvidiaCu13LibraryPath final.nvidia-curand)
        (nvidiaCu13LibraryPath final.nvidia-cusolver)
        (nvidiaCu13LibraryPath final.nvidia-cusparse)
        (nvidiaLibraryPath final."nvidia-cusparselt-cu13" "cusparselt")
        (nvidiaLibraryPath final."nvidia-nccl-cu13" "nccl")
        (nvidiaCu13LibraryPath final.nvidia-nvjitlink)
        (nvidiaLibraryPath final."nvidia-nvshmem-cu13" "nvshmem")
      ];
    in
    lib.optionalAttrs packageLib.isLinux {
      nvidia-cufile = prev.nvidia-cufile.overrideAttrs (oldAttrs: {
        buildInputs = (oldAttrs.buildInputs or [ ]) ++ [ rdma-core ];
      });
      nvidia-cusolver = prev.nvidia-cusolver.overrideAttrs (oldAttrs: {
        buildInputs = (oldAttrs.buildInputs or [ ]) ++ [
          final.nvidia-cublas
          final.nvidia-cusparse
          final.nvidia-nvjitlink
        ];
        preFixup = (oldAttrs.preFixup or "") + ''
          addAutoPatchelfSearchPath ${nvidiaCu13LibraryPath final.nvidia-cublas}
          addAutoPatchelfSearchPath ${nvidiaCu13LibraryPath final.nvidia-cusparse}
          addAutoPatchelfSearchPath ${nvidiaCu13LibraryPath final.nvidia-nvjitlink}
        '';
      });
      nvidia-cusparse = prev.nvidia-cusparse.overrideAttrs (oldAttrs: {
        buildInputs = (oldAttrs.buildInputs or [ ]) ++ [ final.nvidia-nvjitlink ];
        preFixup = (oldAttrs.preFixup or "") + ''
          addAutoPatchelfSearchPath ${nvidiaCu13LibraryPath final.nvidia-nvjitlink}
        '';
      });
      nvidia-nvshmem-cu13 = prev.nvidia-nvshmem-cu13.overrideAttrs (oldAttrs: {
        buildInputs = (oldAttrs.buildInputs or [ ]) ++ [
          libfabric
          openmpi
          pmix
          rdma-core
          ucx
        ];
      });
      torch = prev.torch.overrideAttrs (oldAttrs: {
        buildInputs = (oldAttrs.buildInputs or [ ]) ++ [
          final.nvidia-cublas
          final.nvidia-cuda-cupti
          final.nvidia-cuda-nvrtc
          final.nvidia-cuda-runtime
          final."nvidia-cudnn-cu13"
          final.nvidia-cufft
          final.nvidia-cufile
          final.nvidia-curand
          final.nvidia-cusolver
          final.nvidia-cusparse
          final."nvidia-cusparselt-cu13"
          final."nvidia-nccl-cu13"
          final.nvidia-nvjitlink
          final."nvidia-nvshmem-cu13"
        ];
        preFixup =
          (oldAttrs.preFixup or "")
          + "\n"
          + lib.concatMapStringsSep "\n" (path: "addAutoPatchelfSearchPath ${path}") torchNvidiaLibraries;
        autoPatchelfIgnoreMissingDeps = [ "libcuda.so.1" ];
      });
    };
in
packageLib.mkUvApplication {
  inherit
    extras
    packageOverrides
    pname
    pyproject
    ;

  python = python314;

  installCheck = ''
    "$out/bin/code-review-graph" --help > /dev/null
    "$out/bin/crg-daemon" --help > /dev/null
  '';

  meta = pin: {
    homepage = "https://github.com/tirth8205/code-review-graph";
    license = lib.licenses.mit;
    description = "Local-first code intelligence graph for MCP and CLI";
    changelog = "https://github.com/tirth8205/code-review-graph/releases/tag/v${pin.version}";
  };
}
