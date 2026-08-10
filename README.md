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

## 二进制缓存

CI 只向公共 Cachix 发布 `passthru.cacheDistribution = "allow"` 的包闭包。SUL 包需要单独确认非商业分发条件；`grokBuild` 与 `minerUFull` 在来源或闭包审计完成前不会发布。`strictDoc` 的二进制输出保留其上游 `LICENSE` 与 `NOTICE`。

仓库管理员需要把公共 cache 名写入 GitHub Actions 变量 `CACHIX_CACHE_NAME`，把写入 token 写入 secret `CACHIX_AUTH_TOKEN`。消费者随后运行：

```console
nix run nixpkgs#cachix -- use <CACHIX_CACHE_NAME>
```

公共 cache 建立并取得真实公钥后，再把 substituter 和公钥写入本 flake；公钥不得使用占位值。

## 相关项目

- [llm-agents.nix](https://github.com/numtide/llm-agents.nix)：启发
