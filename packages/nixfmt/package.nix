{
  lib,
  stdenv,
  haskell,
  haskellPackages,
  packageLib,
  versionCheckHook,
}:
let
  pname = "nixfmt";

  inherit (haskell.lib.compose) justStaticExecutables;
  canExecute = stdenv.buildPlatform.canExecute stdenv.hostPlatform;

  rawPackage = haskellPackages.callPackage ./generatedPackage.nix { };
in
lib.pipe rawPackage [
  justStaticExecutables
  (
    package:
    package.overrideAttrs (oldAttrs: {
      strictDeps = true;
      __structuredAttrs = true;

      nativeBuildInputs = (oldAttrs.nativeBuildInputs or [ ]) ++ [ packageLib.removeReferencesTo ];
      nativeInstallCheckInputs = (oldAttrs.nativeInstallCheckInputs or [ ]) ++ [ versionCheckHook ];

      doInstallCheck = canExecute;
      versionCheckProgram = "${placeholder "out"}/bin/nixfmt";
      versionCheckProgramArg = "--version";

      postFixup = (oldAttrs.postFixup or "") + packageLib.removeSelfReferences [ "$out/bin/nixfmt" ];

      postInstallCheck = (oldAttrs.postInstallCheck or "") + ''
        . ${../../lib/package.sh}

        helpOutput="$("$out/bin/nixfmt" --help 2>&1)"
        case "$helpOutput" in
          *"nixfmt [OPTIONS] [FILES]"*) ;;
          *) failCheck "unexpected nixfmt --help output" ;;
        esac

        checkTestDir="$(mktemp -d)"
        unformattedFile="$checkTestDir/unformatted.nix"
        formattedFile="$checkTestDir/formatted.nix"

        printf '{\nfoo=1;\n}\n' > "$unformattedFile"
        if "$out/bin/nixfmt" --strict --check "$unformattedFile" 2>/dev/null; then
          failCheck "nixfmt --check accepted unformatted input"
        fi

        "$out/bin/nixfmt" --verify --strict < "$unformattedFile" > "$formattedFile"
        "$out/bin/nixfmt" --verify --strict --check "$formattedFile"

        printf '{ foo = 1; }\n' | "$out/bin/nixfmt" --verify --strict --check >/dev/null
      '';

      meta = (oldAttrs.meta or { }) // {
        mainProgram = pname;
        sourceProvenance = with lib.sourceTypes; [ fromSource ];
        changelog = "https://github.com/NixOS/nixfmt/releases/tag/v${oldAttrs.version}";
      };
    })
  )
]
