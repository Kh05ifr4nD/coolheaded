{
  lib,
  stdenv,
  autoPatchelfHook,
  coolheaded,
  makeWrapper,
  nodejs,
  packageLib,
}:
let
  pname = "lazycodex-ai";
  pin = builtins.fromJSON (builtins.readFile ./pin.json);

  platformMap = {
    aarch64-darwin = {
      biome = "cli-darwin-arm64";
      commentChecker = "darwin-arm64";
      lightningcss = "lightningcss-darwin-arm64";
      rolldown = "binding-darwin-arm64";
    };
    aarch64-linux = {
      biome = "cli-linux-arm64";
      commentChecker = "linux-arm64";
      lightningcss = "lightningcss-linux-arm64-gnu";
      rolldown = "binding-linux-arm64-gnu";
    };
    x86_64-linux = {
      biome = "cli-linux-x64";
      commentChecker = "linux-x64";
      lightningcss = "lightningcss-linux-x64-gnu";
      rolldown = "binding-linux-x64-gnu";
    };
  };
  platform = packageLib.releaseTarget pname platformMap;

  packageName = "lazycodex-ai";
  packageRoot = "${placeholder "out"}/libexec/lazycodex-ai";
  codeGraphExecutable = "${coolheaded.codegraph}/bin/codegraph";
  nodeExecutable = "${nodejs}/bin/node";
  nodePath = lib.makeBinPath [ nodejs ];
in
packageLib.mkNpmTarballPackage {
  inherit pname;
  inherit packageName;
  changelog =
    { version, ... }: "https://github.com/code-yeongyu/oh-my-openagent/releases/tag/v${version}";

  nativeBuildInputs = [
    makeWrapper
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src" --strip-components=1
    runHook postUnpack
  '';

  installPhase = ''
        runHook preInstall

        . ${../../lib/package.sh}

        patch -p1 < ${./patch/normalizeCopiedPluginCachePermissions.patch}

        packageRoot="$out/libexec/lazycodex-ai"
        mkdir -p "$packageRoot" "$out/bin"
        cp -R . "$packageRoot/"
        rm -f "$packageRoot/.attrs.json" "$packageRoot/.attrs.sh" "$packageRoot/env-vars"
        find "$packageRoot/packages/omo-codex/plugin" -type d -name .github -prune -exec rm -rf {} +

        LAZYCODEX_PLUGIN_ROOT="$packageRoot/packages/omo-codex/plugin" \
        LAZYCODEX_NODE_EXECUTABLE="${nodeExecutable}" \
        LAZYCODEX_CODEGRAPH_EXECUTABLE="${codeGraphExecutable}" \
          "${nodeExecutable}" <<'EOF'
        const fs = require("node:fs");
        const path = require("node:path");

        function mustEnv(name) {
          const value = process.env[name];
          if (value === undefined || value === "") {
            throw new Error("missing " + name);
          }
          return value;
        }

        const pluginRoot = mustEnv("LAZYCODEX_PLUGIN_ROOT");
        const nodeExecutable = mustEnv("LAZYCODEX_NODE_EXECUTABLE");
        const codeGraphExecutable = mustEnv("LAZYCODEX_CODEGRAPH_EXECUTABLE");

        function isRecord(value) {
          return value !== null && typeof value === "object" && !Array.isArray(value);
        }

        function readJson(file) {
          return JSON.parse(fs.readFileSync(file, "utf8"));
        }

        function writeJson(file, value) {
          fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
        }

        function relativePluginPath(file) {
          return path.relative(pluginRoot, file).split(path.sep).join("/");
        }

        function collectMaterializedJsonFiles(root) {
          const files = [];
          function walk(directory) {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
              if (entry.name === ".git" || entry.name === "node_modules") {
                continue;
              }
              const file = path.join(directory, entry.name);
              const relative = relativePluginPath(file);
              if (entry.isDirectory()) {
                walk(file);
                continue;
              }
              if (!entry.isFile() || !entry.name.endsWith(".json")) {
                continue;
              }
              if (
                relative === ".mcp.json" ||
                relative.startsWith("hooks/") ||
                relative.endsWith("/.mcp.json") ||
                relative.includes("/hooks/")
              ) {
                files.push(file);
              }
            }
          }
          walk(root);
          return files;
        }

        function rewriteCommand(command) {
          let next = command;
          if (next === "node") {
            next = nodeExecutable;
          } else if (next.startsWith("node ")) {
            next = nodeExecutable + next.slice("node".length);
          }
          if (!next.includes("components/codegraph/dist/cli.js")) {
            return next;
          }
          const prefix = "OMO_CODEGRAPH_BIN=" + codeGraphExecutable + " ";
          if (next.startsWith(prefix)) {
            return next;
          }
          if (next.startsWith("OMO_CODEGRAPH_BIN=")) {
            return next.replace(/^OMO_CODEGRAPH_BIN=\S+\s+/, prefix);
          }
          return prefix + next;
        }

        function visitRecords(value, visit) {
          if (Array.isArray(value)) {
            for (const entry of value) {
              visitRecords(entry, visit);
            }
            return;
          }
          if (!isRecord(value)) {
            return;
          }
          visit(value);
          for (const entry of Object.values(value)) {
            visitRecords(entry, visit);
          }
        }

        for (const file of collectMaterializedJsonFiles(pluginRoot)) {
          const parsed = readJson(file);
          let changed = false;
          visitRecords(parsed, (record) => {
            if (typeof record.command !== "string") {
              return;
            }
            const next = rewriteCommand(record.command);
            if (next !== record.command) {
              record.command = next;
              changed = true;
            }
          });
          if (changed) {
            writeJson(file, parsed);
          }
        }

        const rootMcpPath = path.join(pluginRoot, ".mcp.json");
        const rootMcp = readJson(rootMcpPath);
        const codegraphServer = rootMcp.mcpServers?.codegraph;
        if (!isRecord(codegraphServer)) {
          throw new Error("missing codegraph MCP server in OMO plugin");
        }
        const env = isRecord(codegraphServer.env) ? codegraphServer.env : {};
        if (env.OMO_CODEGRAPH_BIN !== codeGraphExecutable) {
          codegraphServer.env = { ...env, OMO_CODEGRAPH_BIN: codeGraphExecutable };
          writeJson(rootMcpPath, rootMcp);
        }
    EOF

        pluginNodeModules="$packageRoot/packages/omo-codex/plugin/node_modules"
        keepOnlyMatchingChildren "$pluginNodeModules/@biomejs" "cli-" '${platform.biome}'
        keepOnlyMatchingChildren "$pluginNodeModules/@rolldown" "binding-" '${platform.rolldown}'
        keepOnlyMatchingChildren "$pluginNodeModules" "lightningcss-" '${platform.lightningcss}'
        keepOnlyMatchingChildren "$pluginNodeModules/@code-yeongyu/comment-checker/vendor" "" '${platform.commentChecker}'
        makeWrapper "${nodeExecutable}" "$out/bin/lazycodex-ai" \
          --add-flags "$packageRoot/packages/omo-codex/scripts/install-local.mjs" \
          --set-default LAZYCODEX_AI_NIX_SKIP_CACHE_NPM 1 \
          --prefix PATH : "${nodePath}"

        runHook postInstall
  '';

  versionCheckProgram = "${placeholder "out"}/bin/lazycodex-ai";
  installCheck.extra = ''
        helpOutput="$("$out/bin/lazycodex-ai" --help 2>&1)"
        case "$helpOutput" in
          *"Usage: lazycodex-ai install"*) ;;
          *) failCheck "unexpected lazycodex-ai --help output" ;;
        esac

        installCheckHome="$PWD/installCheckHome"
        installCheckCodexHome="$PWD/installCheckCodexHome"
        installCheckTmp="$PWD/installCheckTmp"
        installOutput="$PWD/lazycodex-install.log"
        mkdir -p "$installCheckHome" "$installCheckCodexHome" "$installCheckTmp"

        chmod -R a-w "${packageRoot}/packages/omo-codex/plugin"

        runLazyCodexInstallCheck() {
          installAttempt="$1"
          if ! HOME="$installCheckHome" \
            CODEX_HOME="$installCheckCodexHome" \
            TMPDIR="$installCheckTmp" \
            OMO_CODEX_DISABLE_POSTHOG=1 \
            "$out/bin/lazycodex-ai" install --no-tui > "$installOutput" 2>&1; then
            sed -n '1,160p' "$installOutput" >&2
            failCheck "lazycodex-ai install attempt $installAttempt against a read-only packaged plugin source failed"
          fi
        }

        runLazyCodexInstallCheck 1
        runLazyCodexInstallCheck 2

        pluginRoot="$installCheckCodexHome/plugins/cache/sisyphuslabs/omo/${pin.version}"
        assertFileExists "$pluginRoot/.codex-plugin/plugin.json"
        assertFileExists "$installCheckCodexHome/config.toml"
        test -w "$pluginRoot/.codex-plugin" \
          || failCheck "installed plugin manifest directory is not writable"
        test -w "$pluginRoot/components/lsp-daemon/dist" \
          || failCheck "installed runtime dist directory is not writable"
        staleTmp="$(find "$installCheckCodexHome/plugins/cache/sisyphuslabs/omo" \
          -mindepth 1 -maxdepth 1 -name '.tmp-*' -print -quit)"
        test -z "$staleTmp" || failCheck "left stale plugin temp directory: $staleTmp"

        assertFileExists "${codeGraphExecutable}"
        LAZYCODEX_PLUGIN_ROOT="$pluginRoot" \
        LAZYCODEX_CODEX_CONFIG="$installCheckCodexHome/config.toml" \
        LAZYCODEX_NODE_EXECUTABLE="${nodeExecutable}" \
        LAZYCODEX_CODEGRAPH_EXECUTABLE="${codeGraphExecutable}" \
          "${nodeExecutable}" <<'EOF'
        const crypto = require("node:crypto");
        const fs = require("node:fs");
        const path = require("node:path");

        function mustEnv(name) {
          const value = process.env[name];
          if (value === undefined || value === "") {
            throw new Error("missing " + name);
          }
          return value;
        }

        const pluginRoot = mustEnv("LAZYCODEX_PLUGIN_ROOT");
        const configPath = mustEnv("LAZYCODEX_CODEX_CONFIG");
        const nodeExecutable = mustEnv("LAZYCODEX_NODE_EXECUTABLE");
        const codeGraphExecutable = mustEnv("LAZYCODEX_CODEGRAPH_EXECUTABLE");

        function fail(message) {
          console.error(message);
          process.exit(1);
        }

        function isRecord(value) {
          return value !== null && typeof value === "object" && !Array.isArray(value);
        }

        function readJson(file) {
          return JSON.parse(fs.readFileSync(file, "utf8"));
        }

        function relativePluginPath(file) {
          return path.relative(pluginRoot, file).split(path.sep).join("/");
        }

        function collectJsonFiles(root) {
          const files = [];
          function walk(directory) {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
              if (entry.name === ".git" || entry.name === "node_modules") {
                continue;
              }
              const file = path.join(directory, entry.name);
              const relative = relativePluginPath(file);
              if (entry.isDirectory()) {
                walk(file);
                continue;
              }
              if (!entry.isFile() || !entry.name.endsWith(".json")) {
                continue;
              }
              if (
                relative === ".mcp.json" ||
                relative.startsWith("hooks/") ||
                relative.endsWith("/.mcp.json") ||
                relative.includes("/hooks/")
              ) {
                files.push(file);
              }
            }
          }
          walk(root);
          return files;
        }

        function visitRecords(value, visit) {
          if (Array.isArray(value)) {
            for (const entry of value) {
              visitRecords(entry, visit);
            }
            return;
          }
          if (!isRecord(value)) {
            return;
          }
          visit(value);
          for (const entry of Object.values(value)) {
            visitRecords(entry, visit);
          }
        }

        const bareNodeCommands = [];
        for (const file of collectJsonFiles(pluginRoot)) {
          const parsed = readJson(file);
          visitRecords(parsed, (record) => {
            if (typeof record.command !== "string") {
              return;
            }
            if (record.command === "node" || record.command.startsWith("node ")) {
              bareNodeCommands.push(relativePluginPath(file) + ": " + record.command);
            }
          });
        }
        if (bareNodeCommands.length > 0) {
          fail("installed OMO plugin contains bare node command: " + bareNodeCommands[0]);
        }

        const rootMcp = readJson(path.join(pluginRoot, ".mcp.json"));
        const mcpServers = rootMcp.mcpServers;
        if (!isRecord(mcpServers)) {
          fail("installed OMO plugin has no mcpServers object");
        }
        for (const serverName of ["codegraph", "git_bash", "lsp"]) {
          const server = mcpServers[serverName];
          if (!isRecord(server)) {
            fail("missing OMO MCP server: " + serverName);
          }
          if (server.command !== nodeExecutable) {
            fail("OMO MCP server " + serverName + " does not use packaged node: " + server.command);
          }
        }
        const codegraphEnv = mcpServers.codegraph.env;
        if (!isRecord(codegraphEnv) || codegraphEnv.OMO_CODEGRAPH_BIN !== codeGraphExecutable) {
          fail("OMO codegraph MCP server is missing packaged OMO_CODEGRAPH_BIN");
        }

        const eventLabels = new Map([
          ["PreToolUse", "pre_tool_use"],
          ["PermissionRequest", "permission_request"],
          ["PostToolUse", "post_tool_use"],
          ["PreCompact", "pre_compact"],
          ["PostCompact", "post_compact"],
          ["SessionStart", "session_start"],
          ["UserPromptSubmit", "user_prompt_submit"],
          ["SubagentStart", "subagent_start"],
          ["SubagentStop", "subagent_stop"],
          ["Stop", "stop"],
        ]);

        function canonicalJson(value) {
          if (Array.isArray(value)) {
            return value.map(canonicalJson);
          }
          if (!isRecord(value)) {
            return value;
          }
          const result = {};
          for (const key of Object.keys(value).sort()) {
            result[key] = canonicalJson(value[key]);
          }
          return result;
        }

        function commandHookHash(eventName, matcher, handler, command) {
          const timeout = Math.max(Number(handler.timeout ?? 600), 1);
          const normalizedHandler = {
            type: "command",
            command,
            timeout,
            async: false,
          };
          if (typeof handler.statusMessage === "string") {
            normalizedHandler.statusMessage = handler.statusMessage;
          }
          const identity = { event_name: eventName, hooks: [normalizedHandler] };
          if (typeof matcher === "string") {
            identity.matcher = matcher;
          }
          const canonical = JSON.stringify(canonicalJson(identity));
          return "sha256:" + crypto.createHash("sha256").update(canonical).digest("hex");
        }

        function stripDotSlash(value) {
          return value.startsWith("./") ? value.slice(2) : value;
        }

        function hookManifestPaths(value) {
          if (typeof value === "string" && value.trim() !== "") {
            return [stripDotSlash(value)];
          }
          if (!Array.isArray(value)) {
            return [];
          }
          return value
            .filter((item) => typeof item === "string" && item.trim() !== "")
            .map(stripDotSlash);
        }

        function trustedHookStatesForHooksFile(keySource, hooks) {
          const states = [];
          for (const [eventName, groups] of Object.entries(hooks)) {
            if (!Array.isArray(groups)) {
              continue;
            }
            const eventLabel = eventLabels.get(eventName);
            if (eventLabel === undefined) {
              continue;
            }
            for (const [groupIndex, group] of groups.entries()) {
              if (!isRecord(group) || !Array.isArray(group.hooks)) {
                continue;
              }
              for (const [handlerIndex, handler] of group.hooks.entries()) {
                if (!isRecord(handler) || handler.type !== "command" || handler.async === true) {
                  continue;
                }
                if (typeof handler.command !== "string" || handler.command.trim() === "") {
                  continue;
                }
                const key = keySource + ":" + eventLabel + ":" + groupIndex + ":" + handlerIndex;
                states.push({
                  key,
                  trustedHash: commandHookHash(eventLabel, group.matcher, handler, handler.command),
                });
              }
            }
          }
          return states;
        }

        const manifest = readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
        const expectedStates = [];
        for (const hookPath of hookManifestPaths(manifest.hooks)) {
          const hooksPath = path.join(pluginRoot, hookPath);
          if (!fs.existsSync(hooksPath)) {
            continue;
          }
          const hooksFile = readJson(hooksPath);
          if (!isRecord(hooksFile) || !isRecord(hooksFile.hooks)) {
            continue;
          }
          expectedStates.push(
            ...trustedHookStatesForHooksFile("omo@sisyphuslabs:" + hookPath, hooksFile.hooks),
          );
        }
        if (expectedStates.length === 0) {
          fail("installed OMO plugin produced no trusted hook states");
        }

        function escapeRegex(value) {
          return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
        }

        const config = fs.readFileSync(configPath, "utf8");
        for (const state of expectedStates) {
          const escapedKey = escapeRegex(JSON.stringify(state.key).slice(1, -1));
          const pattern = new RegExp(
            "\\[hooks\\.state\\.\"" + escapedKey + "\"\\]\\s+trusted_hash\\s*=\\s*\"" +
              escapeRegex(state.trustedHash) +
              "\"",
          );
          if (!pattern.test(config)) {
            fail("missing or stale trusted hook hash for " + state.key);
          }
        }
    EOF

        test ! -e "$out/bin/lazycodex" || failCheck "unexpected lazycodex compatibility launcher"
        assertFileExists "${packageRoot}/packages/omo-codex/marketplace.json"
        assertFileExists "${packageRoot}/packages/omo-codex/scripts/install-local.mjs"
  '';

  meta = {
    homepage = "https://www.npmjs.com/package/lazycodex-ai";
    license = lib.licenses.unfree;
    description = "Coding agent for tokenmaxxers";
  };
}
