{ self }:

{ lib, ... }:

let
  modules = lib.pipe (builtins.readDir ./.) [
    (lib.filterAttrs (
      name: type: name != "default.nix" && type == "regular" && lib.hasSuffix ".nix" name
    ))
    builtins.attrNames
    (map (file: import (./. + "/${file}") { inherit self; }))
  ];
in
{
  imports = modules;
}
