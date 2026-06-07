# 参考仓库更新自动化与 CI 剖析

## 证据范围

参考对象是本机 `/Users/meandssh/Coolheaded/llm-agents.nix`，重点文件是
`.github/workflows/update.yml`、`.github/workflows/update-flake.yml`、`.github/workflows/auto-merge.yml`、`.github/ci/discovery.py`、`.github/ci/update.py`、`.github/ci/create_pr.py`、`.github/ci/lib.py`。

## 总体模型

参考仓库把更新拆成四层：入口 workflow 只负责调度和参数；discovery
脚本生成更新矩阵；update 脚本执行单个包或 flake input 更新并输出结果；PR
脚本统一提交、推送、创建或刷新 PR。CI 不把每个包的更新逻辑写进 YAML，YAML
只串联稳定步骤。

调用链是：

```text
update.yml
  -> update-flake.yml
    -> discovery.py
      -> update.py package|flake-input <name>
        -> create_pr.py package|flake-input <name> <old> <new>
```

## 调度入口

`.github/workflows/update.yml` 每天四次定时运行，也支持手动指定 `packages` 和
`inputs`。它把真实工作委托给可复用 workflow `update-flake.yml`，传入默认标签
`dependencies,automated`，并默认打开 auto-merge。

这层的价值是入口很薄：调度策略、手动过滤、PR
标签、是否自动合并都在入口处声明，更新细节不进入入口文件。

## 可复用 workflow

`update-flake.yml` 有四个 job。

`discover` 安装 Nix 后运行 `.github/ci/discovery.py`，输出 matrix 和
`has-updates`。它既发现包，也发现 flake inputs。

`update` 按 matrix 并行更新，`fail-fast: false`，单包失败不阻断其它包。它先用
GitHub App token checkout 完整历史，再准备更新分支：包分支是
`update/<name>`，flake input 分支是 `update-<name>`；如果远端分支已存在，就
rebase 到 `origin/main`，rebase 失败则丢弃旧分支状态并回到 main。

`update-readme` 在有更新任务时重建 README，并用单独 PR 承载文档变化。

`summary` 把整体结果写入 GitHub Step Summary，只做状态汇总。

## 发现层

`discovery.py` 用一次 `nix eval` 读取 `flake.packages.${system}`。包进入 matrix
的条件是：存在 version 属性，并且没有
`passthru.hideFromDocs`。手动过滤时，只返回过滤列表中实际存在且可更新的包。

flake input 发现直接读取 `flake.lock` 的 `nodes`，排除 `root`，用 locked rev
的前 8 位作为当前版本展示。

这个设计的核心是“从 flake
自身发现事实”。包列表不手写，版本不从目录名猜，隐藏规则使用包的 passthru。

## 执行层

`update.py` 有两类更新。

包更新优先运行 `packages/<name>/update.py`；没有脚本时退回
`nix-update --flake <name>`，并允许读取
`packages/<name>/nix-update-args`。执行后用 `git diff --quiet`
判断是否真的改动。若有改动，再用
`nix eval .#packages.x86_64-linux.<name>.version --raw` 获取新版本，并尝试读取
`meta.changelog`。

flake input 更新运行 `nix flake update <name>`，再用
`nix flake metadata --json --no-write-lock-file` 取新 rev。

这层只回答三个问题：是否更新、更新后版本是什么、有没有 changelog。它不创建 PR。

## PR 层

`create_pr.py` 接收类型、名称、旧版本、新版本，统一生成分支名、标题、正文和
commit message。提交时运行
`git add .`、`git commit --signoff`、`git push --force`。如果分支已有
PR，就编辑标题和正文；没有 PR 就创建新 PR。`AUTO_MERGE=true` 时调用
`gh pr merge --auto --squash`。

它用 GitHub App token 而非默认 `GITHUB_TOKEN`，原因是更新 PR
需要稳定推送、复用分支、触发后续 CI，并且权限边界清楚。

## 自动合并

`auto-merge.yml` 监听 `pull_request_target`，用 `Mic92/auto-merge`
处理自动合并。它是独立 workflow，不和更新执行耦合。

## 可吸收部分

参考仓库最值得吸收的是工程行为：发现、更新、PR、合并互相独立；包列表由 flake
求值获得；单包更新用 matrix 并行；单包失败不阻断其它包；更新分支可复用；已有 PR
刷新而不是重复创建；PR 提交统一 signoff；无 diff 就不创建
PR；更新脚本只需要造成文件 diff，CI 再从 flake 读取新版本；auto-merge 交给
GitHub required checks 决定合入时机。

这些原则适合当前仓库。

## 不应照搬部分

参考仓库使用 Python 脚本，而当前仓库已有 Deno/TypeScript 工具链、严格
`deno check`、`deno lint`、oxlint、ts-reset 和更新 helper，CI 脚本应使用
TypeScript。

参考仓库允许没有包级更新脚本时回退
`nix-update`。当前仓库已经要求每个包目录必须有 `update.ts`，并且包来源包括
npm、GitHub release、PyPI/uv2nix、Bun、Cargo、Cabal，盲目 fallback 会绕过既有
pin、uv.lock、generatedPackage.nix 规则。

参考仓库的 `hideFromDocs` 语义不等于当前仓库的可更新语义。当前仓库应以
`passthru.updateScript` 存在与否作为自动更新入口，以 package structure test
保证每个包有脚本。

参考仓库有 README 自动生成 job。当前仓库没有自动 README
包表生成机制，不能为了对齐参考仓库而添加 README 更新 PR。

参考仓库把 package 和 flake input 收到一个 discovery matrix。当前仓库还需要 Deno
依赖更新，并且三类更新产物互斥，应该拆成三条独立流水线，只共享分支准备、PR
防重、signoff、auto-merge 和 summary。
