# Coolheaded 自动更新与 CI 设计

## 现状

当前仓库已经有三个关键基础。

第一，包结构是可枚举的。`packages/<package>/package.nix` 是包入口，目录名必须
camelCase，`tests/packageStructure.test.ts` 已强制每个包具备 `package.nix` 和
`update.ts`，并禁止未声明文件。

第二，flake 已集中注入更新入口。`nix/packageSet.nix` 自动发现包目录，并把
`packages/<name>/update.ts` 注入到 `passthru.updateScript`。

第三，更新逻辑已经按来源分层。`src/npmPackageUpdater.ts`、`src/npmRegistry.ts`、`src/releaseUpdater.ts`、`src/sourceHash.ts`、`src/pinJson.ts`、`src/updateScript.ts`
已覆盖 npm、GitHub release/source hash、pin.json 写入和命令执行。

缺口也明确：现有 `update.ts` 需要显式版本参数，不能独立发现 latest；`.github/ci`
还没有真实更新脚本；workflow 尚未把发现、更新、PR 创建串起来。

## 目标

目标是让 CI 能自动更新所有可维护包、flake inputs 和 Deno
依赖，并保持当前仓库的最小结构约束。

包级更新入口统一为：

```text
packages/<name>/update.ts [version]
```

传入版本时更新到指定版本；不传版本时由脚本按该包来源发现最新稳定版本。这个契约保留人工精确更新能力，也让
CI 可以直接运行 `update.ts`。

## 非目标

不引入 Python CI 脚本。

不引入 `nix-update` fallback。

不把各包的来源规则写进 YAML。

不在 Nix build 期间联网或生成 lock。

不为了自动化放宽 `packages/` 文件白名单。

## 来源分类

当前包可归为五类。

npm registry tarball：`codex`、`lazycodex`、`deepscientist`。latest 来自 npm
dist-tags，hash 来自 npm tarball。

GitHub release
二进制或源码：`deno`、`oxlint`、`rumdl`、`shellcheck`、`shfmt`、`ohMyPi`、`entire`、`codegraph`、`semble`、`rtk`。latest
来自 GitHub release 或 tag，资产名由包级规则生成，hash 在更新阶段重算。

PyPI/uv2nix：`mineru`、`openviking`、`codeReviewGraph`、`deepscientist` 的
Python 依赖部分。latest 来自 PyPI JSON；`uv.lock`
由更新脚本在仓库外部更新阶段生成，Nix build 只消费已提交 lock。

Bun/npm 源码构建：`qmd`。latest 来自 npm 或 GitHub tag，更新后重建
`generatedPackage.nix` 和相关 hash。

Cabal/Haskell：`nixfmt`。latest 来自 GitHub tag，更新后让 `callCabal2nix`
在构建阶段按源码重新求导。

## 新增 TypeScript 层

新增 `src/latestVersion.ts`，提供统一 latest 查询接口：

```ts
latestNpmVersion(packageName);
latestGitHubVersion({ owner, repo, tagPrefix, releasePattern });
latestPyPiVersion(projectName);
```

这些函数只返回版本字符串，不写文件。它们用现有 `commandOutput` 或 fetch
API，并把“版本选择规则”显式参数化：npm 读 `dist-tags.latest`，PyPI 读
`info.version`，GitHub 只接受匹配包级 tag/release 规则的版本。

`src/updateScript.ts` 把 `requestedVersion` 扩展为
`requestedOrLatestVersion(args, latest)`。包脚本调用这个 helper
后，只保留本包特有的 asset、target、lock 或 generated 文件规则。

## 三条更新域

包更新域只处理 `packages/<name>/`。发现脚本是
`.github/ci/discoverPackageUpdates.ts`，运行脚本是
`.github/ci/runPackageUpdate.ts`。它用 `nix eval --json` 读取当前 system 的
flake packages，筛出存在 `version` 和 `passthru.updateScript` 的包，输出 package
matrix。更新时运行
`packages/<name>/update.ts [version]`，只允许改该包版本、hash、lock、generated
文件等包级输入。

flake input 更新域只处理 `flake.lock`。发现脚本是
`.github/ci/discoverFlakeInputUpdates.ts`，运行脚本是
`.github/ci/runFlakeInputUpdate.ts`。它从 `flake.lock` 读取 inputs，排除
root，更新时运行 `nix flake update <inputName>`，只允许改 `flake.lock`。

Deno 依赖更新域只处理 `deno.lock`。运行脚本是
`.github/ci/runDenoDepsUpdate.ts`。它运行
`deno install --frozen=false`，只允许改 `deno.lock`，用于刷新
`@jsr/std__*`、`@total-typescript/ts-reset`、`effect`、`fast-check` 等 Deno/npm
imports 的锁定版本。

三条更新域互不相交，不使用一个中心 `discoverUpdates.ts` 或中心
`runUpdate.ts`。共享层只提供
`.github/ci/lib.ts`、`.github/ci/prepareUpdateBranch.ts` 和
`.github/ci/createUpdatePr.ts`。

`prepareUpdateBranch.ts` 复用固定分支，rebase 到 `origin/main`，rebase
失败才重置到 main。分支名是
`update/package/<name>`、`update/flakeInput/<name>`、`update/denoDeps`。

`createUpdatePr.ts` 统一执行 signoff
commit、`git push --force-with-lease`、`gh pr list
--head <branch>`、已有 PR
刷新、无 PR 创建、默认 `gh pr merge --auto --squash`。无 diff
时不提交、不推送、不创建 PR。

## Workflow

新增
`.github/workflows/updatePackages.yml`、`.github/workflows/updateFlakeInputs.yml`、`.github/workflows/updateDenoDeps.yml`。

新增 `.github/workflows/updateAll.yml` 作为组合入口，只调用前三条
workflow，不实现发现和更新逻辑。它支持只启动其中某些更新域。

默认打开 auto-merge，但合入仍由 GitHub required checks 决定。不添加 README 更新
job。

保留 GitHub App token 方案。它适合自动更新 PR：可以推送分支、复用分支、触发
CI，权限也比长期 PAT 清楚。

## 正确性条件

包发现必须来自 flake 求值，不能从目录名直接猜最终 attr。

新版本必须从更新后的 flake package version 读取，不能信任 updater
自己打印的版本。

三类更新必须保持产物互斥：包更新不改 `flake.lock` 和 `deno.lock`；flake input
更新只改 `flake.lock`；Deno 依赖更新只改 `deno.lock`。

更新脚本必须只改本包允许文件、根 lock 文件、generated 文件或 flake.lock；package
structure test 继续兜底。

Python 包的 `uv.lock` 必须在更新阶段生成并提交；构建阶段必须只消费 lock。

GitHub release 包必须在 latest 查询阶段用 tag/release
规则排除同仓库其它产物，例如 oxlint 只能匹配 `apps_v<version>`。

npm 包必须通过 npm registry 获取 dist-tag 和 tarball metadata；普通 npm 依赖仍由
Deno lock/nodeModulesDir 机制处理。

README 不属于当前自动更新产物。自动合并属于 PR 层行为，不改变三类更新域边界。

## 可行性判断

这套设计不改变包构建方式，只补齐更新入口和 CI 编排。风险集中在 latest 查询和各包
update.ts 的可选版本改造，范围清楚且能逐包验证。

最小闭环是：本地手动运行一个 npm 包、一个 GitHub release 包、一个 PyPI/uv2nix
包的无参数 `update.ts`，确认产生预期 diff；分别验证 package、flake input、Deno
deps 三条 workflow 的单独手动触发；最后验证 `updateAll.yml`
能组合调用指定更新域。
