# Coolheaded

以智能体为中心的开发工具打包 Flake，通过 CI 自动更新，提供 overlay 与 homeModule。

## 依赖

项目围绕 Deno、Effect 和 Oxc 生态开发维护，基于 fast-check 框架实现性质基测试。

### Flake

- [flake-parts](https://github.com/hercules-ci/flake-parts)
- [git-hooks.nix](https://github.com/cachix/git-hooks.nix)
- [nixpkgs](https://github.com/NixOS/nixpkgs/tree/nixos-unstable)
- [treefmt-nix](https://github.com/numtide/treefmt-nix)

### JSR & NPM

- [@std/assert](https://jsr.io/@std/assert)
- [@std/cli](https://jsr.io/@std/cli)
- [@std/fs](https://jsr.io/@std/fs)
- [@std/jsonc](https://jsr.io/@std/jsonc)
- [@std/path](https://jsr.io/@std/path)
- [@std/testing](https://jsr.io/@std/testing)
- [@total-typescript/ts-reset](https://npmx.dev/package/@total-typescript/ts-reset)
- [effect](https://npmx.dev/package/effect)
- [fast-check](https://npmx.dev/package/fast-check)

## 支持平台

对齐[三元组](https://github.com/nix-systems/triplet)：NixOS 版本 ≥ 26.11。

- aarch64-darwin
- aarch64-linux
- x86_64-linux

## 相关项目

- [llm-agents.nix](https://github.com/numtide/llm-agents.nix)：启发
