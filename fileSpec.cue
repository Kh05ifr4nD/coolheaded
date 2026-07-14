package fileSpec

#RegularFile: true

#PatchDirectory: {
	[=~"^[a-z][A-Za-z0-9._-]*\\.patch$"]: #RegularFile
}

#PackageDirectory: {
	"check.nix"?:            #RegularFile
	"generatedPackage.nix"?: #RegularFile
	"package.nix"!:          #RegularFile
	"package-lock.json"?:    #RegularFile
	patch?:                  #PatchDirectory
	"pin.json"?:             #RegularFile
	script?: {
		[=~"^[a-z][A-Za-z0-9._-]*\\.mjs$"]: #RegularFile
	}
	"update.ts"!: #RegularFile
	"uv.lock"?:   #RegularFile
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
			".gitignore"!: #RegularFile
			"impact.ts"!:  #RegularFile
			"model.ts"!:   #RegularFile
			"process.ts"!: #RegularFile
			update!: {
				"branch.ts"!:      #RegularFile
				"discover.ts"!:    #RegularFile
				"pullRequest.ts"!: #RegularFile
				discover!: {
					"flakeInput.ts"!: #RegularFile
					"package.ts"!:    #RegularFile
				}
				run!: {
					"denoDependencies.ts"!: #RegularFile
					"flakeInput.ts"!:       #RegularFile
					"package.ts"!:          #RegularFile
				}
			}
		}
		workflows!: {
			"ci.yml"!:     #RegularFile
			"update.yml"!: #RegularFile
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

	homeModules!: {
		"codex.nix"!:       #RegularFile
		"default.nix"!:     #RegularFile
		"lazyCodexAi.nix"!: #RegularFile
		"ohMyPi.nix"!:      #RegularFile
		"paseo.nix"!:       #RegularFile
	}

	lib!: {
		".gitignore"!: #RegularFile
		nix!: {
			"base.nix"!:            #RegularFile
			"default.nix"!:         #RegularFile
			"github.nix"!:          #RegularFile
			"npm.nix"!:             #RegularFile
			"python.nix"!:          #RegularFile
			"renameNoReplace.nix"!: #RegularFile
		}
		"package.sh"!: #RegularFile
		ts!: {
			core!: {
				"temporaryDirectory.ts"!: #RegularFile
				"updateScript.ts"!:       #RegularFile
				"version.ts"!:            #RegularFile
			}
			npm!: {
				"lock.ts"!:          #RegularFile
				"metadata.ts"!:      #RegularFile
				"metadataError.ts"!: #RegularFile
				"packageHash.ts"!:   #RegularFile
				"platformHash.ts"!:  #RegularFile
				"registry.ts"!:      #RegularFile
				"tarball.ts"!:       #RegularFile
			}
			pin!: {
				"json.ts"!:              #RegularFile
				"packageHashConfig.ts"!: #RegularFile
			}
			repo!: {
				"denoSnapshot.ts"!: #RegularFile
				"fileSpec.ts"!:     #RegularFile
				fileSpec!: {
					"check.ts"!: #RegularFile
					"git.ts"!:   #RegularFile
					"model.ts"!: #RegularFile
				}
			}
			source!: {
				"github.ts"!:  #RegularFile
				"version.ts"!: #RegularFile
			}
			system!: {
				"target.ts"!:    #RegularFile
				"targets.json"!: #RegularFile
			}
			update!: {
				"release.ts"!:     #RegularFile
				"rustPackage.ts"!: #RegularFile
				"uvLock.ts"!:      #RegularFile
			}
		}
	}

	packages!: {
		".gitignore"!:                                    #RegularFile
		[=~"^[a-z][A-Za-z0-9]*(?:-[a-z][A-Za-z0-9]*)*$"]: #PackageDirectory
	}

	tests!: {
		"changeImpact.ts"!:      #RegularFile
		"denoDependencies.ts"!:  #RegularFile
		"denoSnapshot.ts"!:      #RegularFile
		"fetchMock.ts"!:         #RegularFile
		"latestVersion.ts"!:     #RegularFile
		"npmPackageHash.ts"!:    #RegularFile
		"packageHashConfig.ts"!: #RegularFile
		"packageHashTypes.ts"!:  #RegularFile
		"packageStructure.ts"!:  #RegularFile
		"releaseHash.ts"!:       #RegularFile
		"pullRequest.ts"!:       #RegularFile
		"systems.ts"!:           #RegularFile
		"testingTypes.ts"!:      #RegularFile
	}
}
