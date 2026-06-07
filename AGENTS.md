# 项目指示

AGENTS.md 与 README.md 的全部表述均为强制规范，任何思考、计划与实现必须全方面全流程精确对齐，严禁弱化、添冗、替换、遗漏和扩展。

## 结构

所有英文目录文件名称均使用 camelCase，上游既定/不便变更名称除外，如 `README.md`。

任何目录文件结构改动必须始终遵守以下规划，若确实需要增删必须先修订本文件！

```text
.
├── .github/
│   ├── ci/
│   │   ├── .gitignore
│   │   ├── createUpdatePr.ts
│   │   ├── discoverFlakeInputUpdates.ts
│   │   ├── discoverPackageUpdates.ts
│   │   ├── lib.ts
│   │   ├── prepareUpdateBranch.ts
│   │   ├── runDenoDepsUpdate.ts
│   │   ├── runFlakeInputUpdate.ts
│   │   └── runPackageUpdate.ts
│   ├── workflows/
│   │   ├── updateAll.yml
│   │   ├── updateDenoDeps.yml
│   │   ├── updateFlakeInputs.yml
│   │   └── updatePackages.yml
│   └── .gitignore
├── docs/
│   ├── coolheadedUpdateAutomationCiDesign.md
│   ├── referenceUpdateAutomationCiAnalysis.md
│   └── updateAutomationImplementationPlan.md
├── lib/
│   ├── nix/
│   │   ├── base.nix
│   │   ├── default.nix
│   │   ├── github.nix
│   │   ├── npm.nix
│   │   └── python.nix
│   └── package.sh
├── nix/
│   ├── checks.nix
│   ├── devShell.nix
│   ├── gitHooks.nix
│   ├── overlay.nix
│   ├── packageSet.nix
│   ├── packages.nix
│   └── treefmt.nix
├── packages/
│   ├── .gitignore
│   └── <package>/
│       ├── patch/?
│       │   └── <patch>.patch
│       ├── generatedPackage.nix?
│       ├── package.nix
│       ├── pin.json?
│       ├── update.ts?
│       └── uv.lock?
├── src/
│   ├── latestVersion.ts
│   ├── npmPackageUpdater.ts
│   ├── npmRegistry.ts
│   ├── npmRegistryErrors.ts
│   ├── npmRegistryTypes.ts
│   ├── npmUpdater.ts
│   ├── packageConfig.ts
│   ├── packageConfigTypes.ts
│   ├── packageName.ts
│   ├── pinJson.ts
│   ├── releaseUpdater.ts
│   ├── system.ts
│   └── updateScript.ts
├── tests/
│   ├── denoDepsUpdate.test.ts
│   ├── latestVersion.test.ts
│   ├── packageName.test.ts
│   ├── packageStructure.test.ts
│   ├── schema.test.ts
│   ├── testingTypes.ts
│   ├── updatePr.test.ts
│   └── type.test.ts
├── .gitignore
├── .oxlintrc.jsonc
├── AGENTS.md
├── deno.jsonc
├── deno.lock
├── flake.lock
├── flake.nix
├── README.md
├── tsReset.d.ts
└── tsconfig.json
```
