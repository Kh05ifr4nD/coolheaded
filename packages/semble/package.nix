{
  lib,
  python3,
  fetchFromGitHub,
  fetchPypi,
  makeWrapper,
}:
let
  pname = "semble";

  pin = builtins.fromJSON (builtins.readFile ./pin.json);

  model2vec = python3.pkgs.buildPythonPackage rec {
    pname = "model2vec";
    version = "0.8.1";
    pyproject = true;

    strictDeps = true;
    __structuredAttrs = true;

    src = fetchPypi {
      inherit pname version;
      hash = "sha256-mjXTX2pETkzsGfICfuEGxUllzSa3/UpPACtfPitnd/Q=";
    };

    build-system = with python3.pkgs; [
      setuptools
      setuptools-scm
    ];
    dependencies = with python3.pkgs; [
      jinja2
      joblib
      numpy
      rich
      safetensors
      setuptools
      tokenizers
      tqdm
    ];

    env.SETUPTOOLS_SCM_PRETEND_VERSION = version;
    doCheck = false;
    pythonImportsCheck = [ "model2vec" ];

    meta = {
      homepage = "https://github.com/MinishLab/model2vec";
      license = lib.licenses.mit;
      description = "Distill a small fast model from any sentence transformer";
    };
  };

  vicinity = python3.pkgs.buildPythonPackage rec {
    pname = "vicinity";
    version = "0.4.4";
    pyproject = true;

    strictDeps = true;
    __structuredAttrs = true;

    src = fetchPypi {
      inherit pname version;
      hash = "sha256-Tg/+G7B4zkYE2nYn0vMgw52W0lKUhdDqpeLEyyuzKys=";
    };

    build-system = with python3.pkgs; [
      setuptools
      setuptools-scm
    ];
    dependencies = with python3.pkgs; [
      numpy
      orjson
      tqdm
    ];

    env.SETUPTOOLS_SCM_PRETEND_VERSION = version;
    doCheck = false;
    pythonImportsCheck = [ "vicinity" ];

    meta = {
      homepage = "https://github.com/MinishLab/vicinity";
      license = lib.licenses.mit;
      description = "Lightweight nearest neighbors library with flexible backends";
    };
  };

  bm25s = python3.pkgs.buildPythonPackage rec {
    pname = "bm25s";
    version = "0.3.9";
    pyproject = true;

    strictDeps = true;
    __structuredAttrs = true;

    src = fetchPypi {
      inherit pname version;
      hash = "sha256-iVxnnZUrfeg1XttfPhpiCh4vKU0dQrkZvwghzOLi9Zc=";
    };

    build-system = with python3.pkgs; [ setuptools ];
    dependencies = with python3.pkgs; [
      numba
      numpy
      orjson
      pystemmer
      tqdm
    ];

    doCheck = false;
    pythonImportsCheck = [ "bm25s" ];

    meta = {
      homepage = "https://github.com/xhluca/bm25s";
      license = lib.licenses.mit;
      description = "Fast lexical search using Best Matching 25";
    };
  };
in
python3.pkgs.buildPythonApplication {
  inherit pname;
  inherit (pin) version;
  pyproject = true;

  strictDeps = true;
  __structuredAttrs = true;

  src = fetchFromGitHub {
    owner = "MinishLab";
    repo = "semble";
    tag = "v${pin.version}";
    inherit (pin) hash;
  };

  build-system = with python3.pkgs; [
    setuptools
    setuptools-scm
  ];
  dependencies = with python3.pkgs; [
    bm25s
    mcp
    model2vec
    numpy
    orjson
    pathspec
    questionary
    tree-sitter
    tree-sitter-language-pack
    vicinity
    watchfiles
  ];
  nativeBuildInputs = [ makeWrapper ];

  env.PYTHONDONTWRITEBYTECODE = "1";
  env.SETUPTOOLS_SCM_PRETEND_VERSION = pin.version;

  postInstall = ''
    makeWrapper "$out/bin/semble" "$out/bin/semble-mcp"
  '';

  pythonImportsCheck = [
    "semble"
    "semble.cli"
    "semble.mcp"
  ];

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck

    "$out/bin/semble" --help > /dev/null
    test -x "$out/bin/semble-mcp"

    runHook postInstallCheck
  '';

  meta = {
    homepage = "https://github.com/MinishLab/semble";
    license = lib.licenses.mit;
    description = "Fast and accurate local code search for AI agents";
    mainProgram = pname;
    platforms = [
      "aarch64-darwin"
      "aarch64-linux"
      "x86_64-linux"
    ];
    sourceProvenance = with lib.sourceTypes; [ fromSource ];
    changelog = "https://github.com/MinishLab/semble/releases/tag/v${pin.version}";
  };
}
