{ package, ... }:

{ minerUWithAll = package.override { withAll = true; }; }
