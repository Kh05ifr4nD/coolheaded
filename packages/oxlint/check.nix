{ package, ... }:

{ oxlintWithoutTypecheck = package.override { withTypecheck = false; }; }
