# 冷静头脑

以智能体为中心的开发工具打包 Flake，通过 CI 自动更新，提供 overlay 与 homeModule。

## 依赖

项目围绕 Deno、Oxc、Effect 等生态开发和维护，基于 fast-check 框架实现性质基测试。

### Flake

- [flake-parts](https://github.com/hercules-ci/flake-parts)
- [git-hooks.nix](https://github.com/cachix/git-hooks.nix)
- [nixpkgs](https://github.com/NixOS/nixpkgs/tree/nixos-unstable)
- [treefmt-nix](https://github.com/numtide/treefmt-nix)

### Npm

- [@jsr/std__assert](https://npmx.dev/package/@jsr/std__assert)
- [@jsr/std__cli](https://npmx.dev/package/@jsr/std__cli)
- [@jsr/std__fs](https://npmx.dev/package/@jsr/std__fs)
- [@jsr/std__jsonc](https://npmx.dev/package/@jsr/std__jsonc)
- [@jsr/std__path](https://npmx.dev/package/@jsr/std__path)
- [@jsr/std__testing](https://npmx.dev/package/@jsr/std__testing)
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
