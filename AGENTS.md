# 项目指示

`AGENTS.md` 与 `README.md` 的每一句表述均为强制规范，任何思考、计划与实现必须全方面全流程精确对齐！严禁擅自弱化、添冗、替换、遗漏和扩展。

## 文件

所有英文目录或文件必须严格遵守既定设计和命名规则。

### 设计

目录文件结构始终以 git 为准且由 `FileSpec.cue` 唯一权威规范，务必保证 `git ls-files --cached` 在检查点与其同步。

对于所有 git 索引的目录与文件，设计中要求的必须存在，可选的必须合规，未声明的一律非法。

### 命名

按以下顺序推导：

+ 若存在上游固定且无法修改或修改代价很大的名称，统一优先使用，如 `node_modules/`、`README.md`、`package-lock.json`。
+ 若名称中存在专有名词，先查找官方（如官网、仓库、包管理）表述以确认其单元数量和语义层数，而不是仅凭词根。
+ 唯一单元名称使用 lowercase，如 `actionlint` 和 `shfmt`（尊重官方表述，不分隔）。
+ 语义扁平多单元命名使用 PascalCase，如 `OhMyPi` 和 `OpenCode`（尊重官方表述，分隔为 2/3 个单元）。
+ 双层语义多单元命名使用外层 Train-Case 内层 PascalCase，如 `LLVMPackages-22`、`Oh-My-OpenAgents` 和 `ZAI-CodingHelper`。
+ 若语义层数过多，必须拆分，创建目录以承担前缀分类层次语义。
