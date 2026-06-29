{ package, ... }:

{ mineruWithAll = package.override { withAll = true; }; }
