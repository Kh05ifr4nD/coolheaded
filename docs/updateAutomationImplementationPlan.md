# 自动更新与 CI 实施计划

## 原则

- 三类更新域互斥：package、flake input、Deno deps。
- package 只改包级输入；flake input 只改 `flake.lock`；Deno deps 只改
  `deno.lock`。
- 共享 PR、分支、summary、基础命令函数。
- 默认 auto-merge；不做 README 更新。
- 构建期不联网，不生成 lock，不写源码树。

## 文件改动

- `.github/ci/lib.ts`：`run`、`gitHasChanges`、`writeOutput`、`readJson`、`nixEvalRaw`。
- `.github/ci/prepareUpdateBranch.ts`：复用固定分支，rebase 到
  `origin/main`，失败才重置。
- `.github/ci/createUpdatePr.ts`：signoff commit、`push --force-with-lease`、PR
  防重、PR 刷新、auto-merge。
- `.github/ci/discoverPackageUpdates.ts`：用 `nix eval` 发现有 `version` 与
  `passthru.updateScript` 的 package。
- `.github/ci/runPackageUpdate.ts`：运行
  `packages/<name>/update.ts [version]`，读取新版本和 changelog。
- `.github/ci/discoverFlakeInputUpdates.ts`：读取 `flake.lock` inputs，排除
  root，支持过滤。
- `.github/ci/runFlakeInputUpdate.ts`：运行
  `nix flake update <inputName>`，读取新 locked rev。
- `.github/ci/runDenoDepsUpdate.ts`：运行
  `deno install --frozen=false`，读取直接 specifier 版本变化。
- `.github/workflows/updatePackages.yml`：package matrix，`fail-fast: false`。
- `.github/workflows/updateFlakeInputs.yml`：flake input
  matrix，`fail-fast: false`。
- `.github/workflows/updateDenoDeps.yml`：单任务更新 `deno.lock`。
- `.github/workflows/updateAll.yml`：组合前三条 workflow，允许只启动某些更新域。
- `src/latestVersion.ts`：npm、GitHub、PyPI latest 查询。
- `src/updateScript.ts`：新增 `requestedOrLatestVersion(args, latest)`。
- `packages/*/update.ts`：全部支持 `update.ts [version]`。
- `tests/*.test.ts`：覆盖结构、latest、matrix、PR 配置、Deno lock 解析。
- `AGENTS.md` 与 `.gitignore`：声明并放行新增 CI 文件。

## 组合关系

- package workflow 调 package discover 和 package runner。
- flake input workflow 调 flake input discover 和 flake input runner。
- Deno deps workflow 直接调 Deno deps runner。
- 三个 runner 只产出 diff 和版本信息。
- 三个 workflow 都调用公共分支准备和 PR 创建。
- `updateAll.yml` 只组合，不分发细节。

## 阶段一：公共 PR 层

实现 `lib.ts`、`prepareUpdateBranch.ts`、`createUpdatePr.ts`。

验收：

```sh
nix develop -c deno test tests/updatePr.test.ts
nix develop -c deno task check
```

必须证明：

- 已有 PR 被刷新。
- 无 PR 才创建。
- 无 diff 不提交。
- 提交带 signoff。
- 默认执行 `gh pr merge --auto --squash`。

## 阶段二：包更新

实现 `latestVersion.ts`，改造所有 `packages/*/update.ts`，实现 package discover
和 runner。

验收：

```sh
nix develop -c packages/codex/update.ts
nix develop -c packages/oxlint/update.ts
nix develop -c packages/mineru/update.ts
nix develop -c .github/ci/discoverPackageUpdates.ts
nix develop -c deno task lint
```

必须证明：

- npm、GitHub release、PyPI/uv2nix、Bun、Cargo、Cabal 类型都覆盖。
- 包更新不改 `flake.lock` 和 `deno.lock`。

## 阶段三：flake input 更新

实现 flake input discover 和 runner。

验收：

```sh
nix develop -c .github/ci/discoverFlakeInputUpdates.ts
nix develop -c .github/ci/runFlakeInputUpdate.ts nixpkgs
nix flake check --print-build-logs
```

必须证明：

- 只改 `flake.lock`。
- 新 rev 从更新后的 lock 读取。

## 阶段四：Deno 依赖更新

实现 Deno deps runner。

验收：

```sh
nix develop -c .github/ci/runDenoDepsUpdate.ts
nix develop -c deno task check
nix develop -c deno task lint
nix develop -c deno task test
```

必须证明：

- 只改 `deno.lock`。
- 直接 specifier 版本变化可写入 PR body。

## 阶段五：workflow 接入

实现四个 workflow，手动逐条验证，再开启定时。

验收：

```sh
nix flake check --print-build-logs
```

GitHub Actions 能分别创建 package、flake input、Deno deps 更新 PR。

## 完成标准

- 三类更新可单独启动。
- `updateAll.yml` 可组合启动。
- 同一更新对象不会重复开 PR。
- 默认 auto-merge 已启用。
- README 不被自动修改。
- tdx 和本机 `nix flake check --print-build-logs` 通过。
