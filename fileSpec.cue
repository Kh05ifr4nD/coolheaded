package fileSpec

#RegularFile: true

#PatchDirectory: {
	[=~"^[a-z][A-Za-z0-9._-]*\\.patch$"]: #RegularFile
}

#PackageDirectoryPath: {
	"check.nix"?:            #RegularFile
	"generatedPackage.nix"?: #RegularFile
	"package.nix"?:          #RegularFile
	"package-lock.json"?:    #RegularFile
	patch?:                  #PatchDirectory
	"pin.json"?:             #RegularFile
	script?: {
		[=~"^[a-z][A-Za-z0-9._-]*\\.mjs$"]: #RegularFile
	}
	"update.ts"?: #RegularFile
	"uv.lock"?:   #RegularFile
}

#PackageDirectory: #PackageDirectoryPath & {
	"package.nix"!: #RegularFile
	"update.ts"!:   #RegularFile
}

#FileSpecPath: {
	".agents"?: {
		skills?: {
			"followOxlintImports"?: {
				"SKILL.md"?: #RegularFile
			}
		}
	}

	".github"?: {
		".gitignore"?:     #RegularFile
		"actionlint.yml"?: #RegularFile
		ci?: {
			".gitignore"?:        #RegularFile
			"coverage.ts"?:       #RegularFile
			"coveragePolicy.ts"?: #RegularFile
			"impact.ts"?:         #RegularFile
			"model.ts"?:          #RegularFile
			"process.ts"?:        #RegularFile
			update?: {
				"branch.ts"?:      #RegularFile
				"discover.ts"?:    #RegularFile
				"pullRequest.ts"?: #RegularFile
				discover?: {
					"flakeInput.ts"?: #RegularFile
					"package.ts"?:    #RegularFile
				}
				run?: {
					"denoDependencies.ts"?: #RegularFile
					"flakeInput.ts"?:       #RegularFile
					"package.ts"?:          #RegularFile
				}
			}
		}
		workflows?: {
			"ci.yml"?:     #RegularFile
			"update.yml"?: #RegularFile
		}
	}

	".gitignore"?:      #RegularFile
	".oxfmtrc.jsonc"?:  #RegularFile
	".oxlintrc.jsonc"?: #RegularFile
	"AGENTS.md"?:       #RegularFile
	"README.md"?:       #RegularFile
	"deno.jsonc"?:      #RegularFile
	"deno.lock"?:       #RegularFile
	"flake.lock"?:      #RegularFile
	"flake.nix"?:       #RegularFile
	"fileSpec.cue"?:    #RegularFile
	"tsReset.d.ts"?:    #RegularFile
	"tsconfig.json"?:   #RegularFile

	flake?: {
		"checks.nix"?:           #RegularFile
		"denoDependencies.nix"?: #RegularFile
		"devShell.nix"?:         #RegularFile
		"gitHooks.nix"?:         #RegularFile
		"overlay.nix"?:          #RegularFile
		"packageSet.nix"?:       #RegularFile
		"packages.nix"?:         #RegularFile
		"treefmt.nix"?:          #RegularFile
	}

	homeModules?: {
		"codex.nix"?:       #RegularFile
		"default.nix"?:     #RegularFile
		"lazyCodexAi.nix"?: #RegularFile
		"ohMyPi.nix"?:      #RegularFile
		"paseo.nix"?:       #RegularFile
	}

	lib?: {
		".gitignore"?: #RegularFile
		nix?: {
			"base.nix"?:    #RegularFile
			"default.nix"?: #RegularFile
			"github.nix"?:  #RegularFile
			"npm.nix"?:     #RegularFile
			"python.nix"?:  #RegularFile
		}
		"package.sh"?: #RegularFile
		ts?: {
			core?: {
				"commandRunner.ts"?:      #RegularFile
				"denoCommandRunner.ts"?:  #RegularFile
				"fetchHttpClient.ts"?:    #RegularFile
				"httpClient.ts"?:         #RegularFile
				"temporaryDirectory.ts"?: #RegularFile
				"updateScript.ts"?:       #RegularFile
				"version.ts"?:            #RegularFile
			}
			npm?: {
				"lock.ts"?:          #RegularFile
				"metadata.ts"?:      #RegularFile
				"metadataError.ts"?: #RegularFile
				"packageHash.ts"?:   #RegularFile
				"platformHash.ts"?:  #RegularFile
				"registry.ts"?:      #RegularFile
				"tarball.ts"?:       #RegularFile
			}
			pin?: {
				"json.ts"?:              #RegularFile
				"packageHashConfig.ts"?: #RegularFile
				"sriHash.ts"?:           #RegularFile
			}
			repo?: {
				"denoSnapshot.ts"?: #RegularFile
				"fileSpec.ts"?:     #RegularFile
				fileSpec?: {
					"check.ts"?: #RegularFile
					"git.ts"?:   #RegularFile
					"model.ts"?: #RegularFile
				}
			}
			source?: {
				"github.ts"?:        #RegularFile
				"githubVersion.ts"?: #RegularFile
				"version.ts"?:       #RegularFile
			}
			system?: {
				"target.ts"?:    #RegularFile
				"targets.json"?: #RegularFile
			}
			update?: {
				"checksumManifest.ts"?: #RegularFile
				"release.ts"?:          #RegularFile
				"rustPackage.ts"?:      #RegularFile
				"uvLock.ts"?:           #RegularFile
			}
		}
	}

	packages?: {
		".gitignore"?:                                    #RegularFile
		[=~"^[a-z][A-Za-z0-9]*(?:-[a-z][A-Za-z0-9]*)*$"]: #PackageDirectoryPath
	}

	tests?: {
		ci?: {
			"changeImpact.ts"?:          #RegularFile
			"coverage.ts"?:              #RegularFile
			"coveragePolicy.ts"?:        #RegularFile
			"denoDependenciesRun.ts"?:   #RegularFile
			"fileSystemPermissions.ts"?: #RegularFile
			"flakeInputRun.ts"?:         #RegularFile
			"packageRun.ts"?:            #RegularFile
			"pullRequest.ts"?:           #RegularFile
			"pullRequestControl.ts"?:    #RegularFile
			"pullRequestFailure.ts"?:    #RegularFile
			"runtimePermissions.ts"?:    #RegularFile
			"taskTopology.ts"?:          #RegularFile
			"updateControl.ts"?:         #RegularFile
			"updateDiscovery.ts"?:       #RegularFile
			"updateGit.ts"?:             #RegularFile
			"updateGitBranch.ts"?:       #RegularFile
			"updateGitFixture.ts"?:      #RegularFile
			"updateRuntime.ts"?:         #RegularFile
			"updateState.ts"?:           #RegularFile
			"updateStateCompletion.ts"?: #RegularFile
			"updateStateContract.ts"?:   #RegularFile
			"updateStateModel.ts"?:      #RegularFile
			"updateStateOracle.ts"?:     #RegularFile
			"updatePackage.ts"?:         #RegularFile
		}
		core?: {
			"commandRunner.ts"?: #RegularFile
			"fastCheck.ts"?:     #RegularFile
			"version.ts"?:       #RegularFile
		}
		nix?: {
			"denoDependencies.ts"?: #RegularFile
			"denoSnapshot.ts"?:     #RegularFile
			"systems.ts"?:          #RegularFile
		}
		npm?: {
			"packageHash.ts"?:       #RegularFile
			"packageHashUpdate.ts"?: #RegularFile
			"platformHash.ts"?:      #RegularFile
			"registry.ts"?:          #RegularFile
			"tarball.ts"?:           #RegularFile
		}
		pin?: {
			"jsonOrder.ts"?:         #RegularFile
			"packageHashConfig.ts"?: #RegularFile
			"sriHash.ts"?:           #RegularFile
		}
		repo?: {
			"fileSpecCli.ts"?:  #RegularFile
			"pathProperty.ts"?: #RegularFile
			fileSpec?: {
				"conformance.ts"?:     #RegularFile
				"fixture.ts"?:         #RegularFile
				"ignoredPath.ts"?:     #RegularFile
				"index.ts"?:           #RegularFile
				"process.ts"?:         #RegularFile
				"snapshot.ts"?:        #RegularFile
				"snapshotFixture.ts"?: #RegularFile
				"toolIdentity.ts"?:    #RegularFile
			}
		}
		source?: {
			"githubVersion.ts"?: #RegularFile
			"httpClient.ts"?:    #RegularFile
			"jsonClient.ts"?:    #RegularFile
			"version.ts"?:       #RegularFile
		}
		support?: {
			"commandRunner.ts"?:  #RegularFile
			"fastCheck.ts"?:      #RegularFile
			"fastCheckError.ts"?: #RegularFile
			"httpClient.ts"?:     #RegularFile
		}
		type?: {
			"packageHashTypes.ts"?:  #RegularFile
			"testingTypes.ts"?:      #RegularFile
			"updateScriptTypes.ts"?: #RegularFile
		}
		update?: {
			"checksumManifest.ts"?:       #RegularFile
			"checksumPackage.ts"?:        #RegularFile
			"checksumPackageFixture.ts"?: #RegularFile
			"checksumPackageHttp.ts"?:    #RegularFile
			"deno.ts"?:                   #RegularFile
			"grokBuild.ts"?:              #RegularFile
			"httpPassThrough.ts"?:        #RegularFile
			"nixfmt.ts"?:                 #RegularFile
			"ohMyOpenAgent.ts"?:          #RegularFile
			"oxfmt.ts"?:                  #RegularFile
			"paseo.ts"?:                  #RegularFile
			"qmd.ts"?:                    #RegularFile
			"releaseHash.ts"?:            #RegularFile
			"rustPackage.ts"?:            #RegularFile
			"stateProperty.ts"?:          #RegularFile
			"uvLock.ts"?:                 #RegularFile
		}
	}
}

#FileSpec: #FileSpecPath & {
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
			".gitignore"!:        #RegularFile
			"coverage.ts"!:       #RegularFile
			"coveragePolicy.ts"!: #RegularFile
			"impact.ts"!:         #RegularFile
			"model.ts"!:          #RegularFile
			"process.ts"!:        #RegularFile
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
			"base.nix"!:    #RegularFile
			"default.nix"!: #RegularFile
			"github.nix"!:  #RegularFile
			"npm.nix"!:     #RegularFile
			"python.nix"!:  #RegularFile
		}
		"package.sh"!: #RegularFile
		ts!: {
			core!: {
				"commandRunner.ts"!:      #RegularFile
				"denoCommandRunner.ts"!:  #RegularFile
				"fetchHttpClient.ts"!:    #RegularFile
				"httpClient.ts"!:         #RegularFile
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
				"sriHash.ts"!:           #RegularFile
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
				"github.ts"!:        #RegularFile
				"githubVersion.ts"!: #RegularFile
				"version.ts"!:       #RegularFile
			}
			system!: {
				"target.ts"!:    #RegularFile
				"targets.json"!: #RegularFile
			}
			update!: {
				"checksumManifest.ts"!: #RegularFile
				"release.ts"!:          #RegularFile
				"rustPackage.ts"!:      #RegularFile
				"uvLock.ts"!:           #RegularFile
			}
		}
	}

	packages!: {
		".gitignore"!:                                    #RegularFile
		[=~"^[a-z][A-Za-z0-9]*(?:-[a-z][A-Za-z0-9]*)*$"]: #PackageDirectory
	}

	tests!: {
		ci!: {
			"changeImpact.ts"!:          #RegularFile
			"coverage.ts"!:              #RegularFile
			"coveragePolicy.ts"!:        #RegularFile
			"denoDependenciesRun.ts"!:   #RegularFile
			"fileSystemPermissions.ts"!: #RegularFile
			"flakeInputRun.ts"!:         #RegularFile
			"packageRun.ts"!:            #RegularFile
			"pullRequest.ts"!:           #RegularFile
			"pullRequestControl.ts"!:    #RegularFile
			"pullRequestFailure.ts"!:    #RegularFile
			"runtimePermissions.ts"!:    #RegularFile
			"taskTopology.ts"!:          #RegularFile
			"updateControl.ts"!:         #RegularFile
			"updateDiscovery.ts"!:       #RegularFile
			"updateGit.ts"!:             #RegularFile
			"updateGitBranch.ts"!:       #RegularFile
			"updateGitFixture.ts"!:      #RegularFile
			"updateRuntime.ts"!:         #RegularFile
			"updateState.ts"!:           #RegularFile
			"updateStateCompletion.ts"!: #RegularFile
			"updateStateContract.ts"!:   #RegularFile
			"updateStateModel.ts"!:      #RegularFile
			"updateStateOracle.ts"!:     #RegularFile
			"updatePackage.ts"!:         #RegularFile
		}
		core!: {
			"commandRunner.ts"!: #RegularFile
			"fastCheck.ts"!:     #RegularFile
			"version.ts"!:       #RegularFile
		}
		nix!: {
			"denoDependencies.ts"!: #RegularFile
			"denoSnapshot.ts"!:     #RegularFile
			"systems.ts"!:          #RegularFile
		}
		npm!: {
			"packageHash.ts"!:       #RegularFile
			"packageHashUpdate.ts"!: #RegularFile
			"platformHash.ts"!:      #RegularFile
			"registry.ts"!:          #RegularFile
			"tarball.ts"!:           #RegularFile
		}
		pin!: {
			"jsonOrder.ts"!:         #RegularFile
			"packageHashConfig.ts"!: #RegularFile
			"sriHash.ts"!:           #RegularFile
		}
		repo!: {
			"fileSpecCli.ts"!:  #RegularFile
			"pathProperty.ts"!: #RegularFile
			fileSpec!: {
				"conformance.ts"!:     #RegularFile
				"fixture.ts"!:         #RegularFile
				"ignoredPath.ts"!:     #RegularFile
				"index.ts"!:           #RegularFile
				"process.ts"!:         #RegularFile
				"snapshot.ts"!:        #RegularFile
				"snapshotFixture.ts"!: #RegularFile
				"toolIdentity.ts"!:    #RegularFile
			}
		}
		source!: {
			"githubVersion.ts"!: #RegularFile
			"httpClient.ts"!:    #RegularFile
			"jsonClient.ts"!:    #RegularFile
			"version.ts"!:       #RegularFile
		}
		support!: {
			"commandRunner.ts"!:  #RegularFile
			"fastCheck.ts"!:      #RegularFile
			"fastCheckError.ts"!: #RegularFile
			"httpClient.ts"!:     #RegularFile
		}
		type!: {
			"packageHashTypes.ts"!:  #RegularFile
			"testingTypes.ts"!:      #RegularFile
			"updateScriptTypes.ts"!: #RegularFile
		}
		update!: {
			"checksumManifest.ts"!:       #RegularFile
			"checksumPackage.ts"!:        #RegularFile
			"checksumPackageFixture.ts"!: #RegularFile
			"checksumPackageHttp.ts"!:    #RegularFile
			"deno.ts"!:                   #RegularFile
			"grokBuild.ts"!:              #RegularFile
			"httpPassThrough.ts"!:        #RegularFile
			"nixfmt.ts"!:                 #RegularFile
			"ohMyOpenAgent.ts"!:          #RegularFile
			"oxfmt.ts"!:                  #RegularFile
			"paseo.ts"!:                  #RegularFile
			"qmd.ts"!:                    #RegularFile
			"releaseHash.ts"!:            #RegularFile
			"rustPackage.ts"!:            #RegularFile
			"stateProperty.ts"!:          #RegularFile
			"uvLock.ts"!:                 #RegularFile
		}
	}
}
