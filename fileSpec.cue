package fileSpec

#RegularFile: true

#PatchDirectory: {
	[=~"^[a-z][A-Za-z0-9._-]*\\.patch$"]: #RegularFile
}

#PackageDirectory: {
	"checks.nix"?:           #RegularFile
	"generatedPackage.nix"?: #RegularFile
	"package.nix"!:          #RegularFile
	"package-lock.json"?:    #RegularFile
	patch?:                  #PatchDirectory
	"pin.json"?:             #RegularFile
	"update.ts"!:            #RegularFile
	"uv.lock"?:              #RegularFile
}

#FileSpec: {
	".agents"!: {
		skills!: {
			"followOxlintImports"!: {
				"SKILL.md"!: #RegularFile
			}
		}
	}

	".github"!: {
		".gitignore"!:     #RegularFile
		"actionlint.yml"!: #RegularFile
		ci!: {
			".gitignore"!:                   #RegularFile
			"createUpdatePr.ts"!:            #RegularFile
			"discoverCiPackageBuilds.ts"!:   #RegularFile
			"discoverFlakeInputUpdates.ts"!: #RegularFile
			"discoverPackageUpdates.ts"!:    #RegularFile
			"discoverUpdates.ts"!:           #RegularFile
			"lib.ts"!:                       #RegularFile
			"prepareUpdateBranch.ts"!:       #RegularFile
			"runDenoDepsUpdate.ts"!:         #RegularFile
			"runFlakeInputUpdate.ts"!:       #RegularFile
			"runPackageUpdate.ts"!:          #RegularFile
		}
		workflows!: {
			"ci.yml"!:        #RegularFile
			"updateAll.yml"!: #RegularFile
		}
	}

	".gitignore"!:      #RegularFile
	".oxfmtrc.jsonc"!:  #RegularFile
	".oxlintrc.jsonc"!: #RegularFile
	"AGENTS.md"!:       #RegularFile
	"README.md"!:       #RegularFile
	"deno.jsonc"!:      #RegularFile
	"deno.lock"!:       #RegularFile
	"flake.lock"!:      #RegularFile
	"flake.nix"!:       #RegularFile
	"fileSpec.cue"!:    #RegularFile
	"tsReset.d.ts"!:    #RegularFile
	"tsconfig.json"!:   #RegularFile

	flake!: {
		"checks.nix"!:           #RegularFile
		"denoDependencies.nix"!: #RegularFile
		"devShell.nix"!:         #RegularFile
		"gitHooks.nix"!:         #RegularFile
		"overlay.nix"!:          #RegularFile
		"packageSet.nix"!:       #RegularFile
		"packages.nix"!:         #RegularFile
		"treefmt.nix"!:          #RegularFile
	}

	lib!: {
		nix!: {
			"base.nix"!:    #RegularFile
			"default.nix"!: #RegularFile
			"github.nix"!:  #RegularFile
			"npm.nix"!:     #RegularFile
			"python.nix"!:  #RegularFile
		}
		"package.sh"!: #RegularFile
		ts!: {
			"checkFileSpec.ts"!:      #RegularFile
			"denoDependencies.ts"!:   #RegularFile
			"latestVersion.ts"!:      #RegularFile
			"npmLockUpdater.ts"!:     #RegularFile
			"npmPackageUpdater.ts"!:  #RegularFile
			"npmRegistry.ts"!:        #RegularFile
			"npmRegistryErrors.ts"!:  #RegularFile
			"npmRegistryTypes.ts"!:   #RegularFile
			"npmTarballUpdater.ts"!:  #RegularFile
			"npmUpdater.ts"!:         #RegularFile
			"packageConfig.ts"!:      #RegularFile
			"packageConfigTypes.ts"!: #RegularFile
			"pinJson.ts"!:            #RegularFile
			"releaseUpdater.ts"!:     #RegularFile
			"rustPackageUpdater.ts"!: #RegularFile
			"sourceHash.ts"!:         #RegularFile
			"system.ts"!:             #RegularFile
			"temporaryDirectory.ts"!: #RegularFile
			"updateScript.ts"!:       #RegularFile
			"uvLockUpdater.ts"!:      #RegularFile
			"version.ts"!:            #RegularFile
		}
	}

	packages!: {
		".gitignore"!:                                    #RegularFile
		[=~"^[a-z][A-Za-z0-9]*(?:-[a-z][A-Za-z0-9]*)*$"]: #PackageDirectory
	}

	tests!: {
		"ciPackageBuilds.ts"!:  #RegularFile
		"denoDepsUpdate.ts"!:   #RegularFile
		"latestVersion.ts"!:    #RegularFile
		"packageStructure.ts"!: #RegularFile
		"schema.ts"!:           #RegularFile
		"systems.ts"!:          #RegularFile
		"testingTypes.ts"!:     #RegularFile
		"type.ts"!:             #RegularFile
		"updatePr.ts"!:         #RegularFile
	}
}
