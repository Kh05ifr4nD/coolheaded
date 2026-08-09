package layout

#RegularFile: true

#Directory: {
	[=~"^[a-z][A-Za-z0-9-]*$"]:                       #Directory
	[=~"^[A-Za-z0-9][A-Za-z0-9.-]*\\.[A-Za-z0-9]+$"]: #RegularFile
}

#PackageDirectory: #Directory & {
	"package.nix"!: #RegularFile
	"update.ts"!:   #RegularFile
}

#LayoutPath: {
	".agents"?:   #Directory
	".github"?:   #Directory
	flake?:       #Directory
	homeModules?: #Directory
	lib?:         #Directory
	packages?: {
		[=~"^[a-z][A-Za-z0-9-]*$"]: #PackageDirectory
	}
	tests?: #Directory

	".gitignore"?:      #RegularFile
	".oxfmtrc.jsonc"?:  #RegularFile
	".oxlintrc.jsonc"?: #RegularFile
	"AGENTS.md"?:       #RegularFile
	"README.md"?:       #RegularFile
	"deno.jsonc"?:      #RegularFile
	"deno.lock"?:       #RegularFile
	"flake.lock"?:      #RegularFile
	"flake.nix"?:       #RegularFile
	"layout.cue"?:      #RegularFile
	"tsReset.d.ts"?:    #RegularFile
	"tsconfig.json"?:   #RegularFile
}

#Layout: #LayoutPath & {
	".agents"!:   #Directory
	".github"!:   #Directory
	flake!:       #Directory
	homeModules!: #Directory
	lib!:         #Directory
	packages!: {
		[=~"^[a-z][A-Za-z0-9-]*$"]: #PackageDirectory
	}
	tests!: #Directory

	".gitignore"!:      #RegularFile
	".oxfmtrc.jsonc"!:  #RegularFile
	".oxlintrc.jsonc"!: #RegularFile
	"AGENTS.md"!:       #RegularFile
	"README.md"!:       #RegularFile
	"deno.jsonc"!:      #RegularFile
	"deno.lock"!:       #RegularFile
	"flake.lock"!:      #RegularFile
	"flake.nix"!:       #RegularFile
	"layout.cue"!:      #RegularFile
	"tsReset.d.ts"!:    #RegularFile
	"tsconfig.json"!:   #RegularFile
}
