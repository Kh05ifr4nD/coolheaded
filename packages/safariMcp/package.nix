{
  buildNpmPackage,
  darwin,
  fetchNpmDeps,
  fetchurl,
  jq,
  lib,
  packageLib,
}:
let
  pin = packageLib.readPin ./pin.json;
  src = fetchurl {
    url = packageLib.npmTarballUrl {
      packageName = "safari-mcp";
      inherit (pin) version;
    };
    hash = pin.platformPackageHashes.aarch64-darwin;
  };
  syncPackageLock = packageLib.syncPackageJsonFromPackageLock {
    packageLock = ./package-lock.json;
    deleteScripts = true;
  };
in
buildNpmPackage {
  pname = "safari-mcp";
  inherit src;
  inherit (pin) version;

  npmDeps = fetchNpmDeps {
    name = "safari-mcp-${pin.version}-npm-deps";
    inherit src;
    hash = pin.npmVendorHash;
    nativeBuildInputs = [ jq ];
    postPatch = syncPackageLock;
  };
  nativeBuildInputs = [
    jq
    darwin.sigtool
  ];
  postPatch = syncPackageLock;
  dontNpmBuild = true;
  npmInstallFlags = [ "--omit=dev" ];

  postFixup = ''
    packageRoot="$out/lib/node_modules/safari-mcp"
    lipo "$packageRoot/safari-helper" -thin arm64 -output "$packageRoot/safari-helper.arm64"
    mv "$packageRoot/safari-helper.arm64" "$packageRoot/safari-helper"
    chmod +x "$packageRoot/safari-helper"
    codesign --force --sign - --identifier com.achiya-automation.safari-mcp \
      --entitlements "$packageRoot/safari-helper.entitlements" "$packageRoot/safari-helper"
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    packageRoot="$out/lib/node_modules/safari-mcp"
    test "$(lipo -archs "$packageRoot/safari-helper")" = arm64
    /usr/bin/codesign --verify --strict "$packageRoot/safari-helper"
    /usr/bin/codesign -d --verbose=2 "$packageRoot/safari-helper" 2>&1 \
      | grep -Fx 'Identifier=com.achiya-automation.safari-mcp'

    cd "$packageRoot"
    node --input-type=module - "$out/bin/safari-mcp" ${lib.escapeShellArg pin.version} <<'JS'
    import assert from 'node:assert/strict';
    import { once } from 'node:events';
    import { mkdtempSync, rmSync } from 'node:fs';
    import { createServer } from 'node:net';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

    const [binary, version] = process.argv.slice(2);
    const testHome = mkdtempSync(join(tmpdir(), 'safari-mcp-check-'));
    const listeners = [createServer(), createServer()];
    const ports = await Promise.all(listeners.map(async listener => {
      listener.listen(0, '127.0.0.1');
      await once(listener, 'listening');
      return String(listener.address().port);
    }));
    await Promise.all(listeners.map(listener => new Promise(resolve => listener.close(resolve))));
    const client = new Client({ name: 'nix-install-check', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: binary,
      env: {
        PATH: process.env.PATH,
        HOME: testHome,
        SAFARI_MCP_QUIET: '1',
        SAFARI_MCP_NO_AUTO_UPGRADE: '1',
        SAFARI_MCP_BRIDGE_PORT: ports[0],
        SAFARI_MCP_BRIDGE_WS_PORT: ports[1],
      },
    });
    const timeout = setTimeout(() => {
      console.error('MCP install check timed out');
      void transport.close().finally(() => process.exit(1));
    }, 15000);
    try {
      await client.connect(transport);
      assert.equal(client.getServerVersion().name, 'safari-mcp');
      assert.equal(client.getServerVersion().version, version);
      const { tools } = await client.listTools();
      for (const name of ['safari_navigate', 'safari_list_tabs', 'safari_doctor'])
        assert(tools.some(tool => tool.name === name), 'missing tool: ' + name);
      console.log('MCP handshake passed; registered ' + tools.length + ' tools');
    } finally {
      clearTimeout(timeout);
      await client.close();
      rmSync(testHome, { recursive: true, force: true });
    }
    JS
    runHook postInstallCheck
  '';

  meta = {
    description = "Native Safari browser automation over MCP";
    homepage = "https://github.com/achiya-automation/safari-mcp";
    changelog = "https://github.com/achiya-automation/safari-mcp/releases/tag/v${pin.version}";
    license = lib.licenses.mit;
    mainProgram = "safari-mcp";
    platforms = builtins.fromJSON (builtins.readFile ./systems.json);
    sourceProvenance = with lib.sourceTypes; [
      fromSource
      binaryNativeCode
    ];
  };
}
