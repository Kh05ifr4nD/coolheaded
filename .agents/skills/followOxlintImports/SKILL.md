---
name: followOxlintImports
description: Use when editing TypeScript imports/exports, fixing oxlint import/sort/type-import errors, adding a module dependency, or reviewing changes that touch import declarations.
---

# 遵守 Oxlint Import 规则

首先阅读 `.oxlintrc.jsonc`、`deno.jsonc`。

## 规范

- 使用 ESM。禁用 `require`、CommonJS、AMD、动态 require、webpack loader 等语法。
- 使用命名导出。不要新增 `export default` 或为单文件使用匿名默认导出，除非是某些配置文件固定写法。
- 类型只作为类型使用时应 `import type { T } from "...";`。不要把值和类型混在同一个 import 里。
- 本地模块需要显式 `.ts` 后缀。
- 禁止绝对路径、自导入、重复导入、空命名导入块、可变导出、命名空间导入。
- 禁止副作用导入 `import "..."`。确实需要时，先在 `.oxlintrc.jsonc` 添加严格受限范围 allow 并说明理由。
- 不导入 Node 内置模块。确实需要 Node 兼容层时再三确认规则边界。
- 非类型依赖每个文件最多 48 个。若超过则拆分文件或下沉辅助逻辑。
- 避免值依赖环。只含 `import type` 的循环默认会被 `import/no-cycle` 忽略；修复方法为调整依赖方向或抽象共享模块。
- 严禁使用注释绕过规则。

## 排序规则

- `sort-imports` 先按 import 语法形态排序，再按第一个成员或别名做大小写敏感排序，而不是按路径分组优先。
- 默认语法形态顺序是 `none`、`all`、`multiple`、`single`。由于同时禁用副作用导入和命名空间导入，所以正常只需处理 `multiple` 与 `single`。
- 花括号内成员也要排序。
- 大小写敏感意味着全大写标识符需排在小写标识符前面。

## 相关规则

Import 插件规则：`import/consistent-type-specifier-style`、`import/default`、`import/export`、`import/exports-last`、`import/extensions`、`import/first`、`import/group-exports`、`import/max-dependencies`、`import/named`、`import/namespace`、`import/newline-after-import`、`import/no-absolute-path`、`import/no-amd`、`import/no-anonymous-default-export`、`import/no-commonjs`、`import/no-cycle`、`import/no-default-export`、`import/no-duplicates`、`import/no-dynamic-require`、`import/no-empty-named-blocks`、`import/no-mutable-exports`、`import/no-named-as-default`、`import/no-named-as-default-member`、`import/no-named-default`、`import/no-namespace`、`import/no-nodejs-modules`、`import/no-relative-parent-imports`、`import/no-self-import`、`import/no-unassigned-import`、`import/no-webpack-loader-syntax`、`import/unambiguous`。

配套规则：`sort-imports`、`no-duplicate-imports`、`no-import-assign`、`no-restricted-exports`、`no-restricted-imports`、`no-useless-rename`、`typescript/consistent-type-exports`、`typescript/consistent-type-imports`、`typescript/no-import-type-side-effects`、`typescript/no-require-imports`、`typescript/no-useless-empty-export`、`typescript/no-var-requires`、`node/global-require`、`node/no-exports-assign`、`node/no-new-require`、`unicorn/import-style`、`unicorn/no-anonymous-default-export`、`unicorn/prefer-import-meta-properties`。

明确关闭的规则只有两个：`import/no-named-export`、`import/prefer-default-export`。
