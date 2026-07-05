{ package, ... }:

{ openVikingBot = package.override { withBot = true; }; }
