{ package, ... }:

{ minerUFull = package.override { withAll = true; }; }
