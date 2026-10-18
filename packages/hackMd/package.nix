{
  buildNpmPackage,
  fetchNpmDeps,
  jq,
  lib,
  makeWrapper,
  nodejs,
  packageLib,
}:
packageLib.mkNpmCliPackage {
  inherit
    buildNpmPackage
    fetchNpmDeps
    jq
    makeWrapper
    nodejs
    ;

  pname = "hackmd-cli";
  packageName = "@hackmd/hackmd-cli";
  cliPath = "bin/run";
  launcherNames = [ "hackmd-cli" ];
  installItems = [
    "LICENSE"
    "README.md"
    "bin/run"
    "lib"
    "node_modules"
    "oclif.manifest.json"
    "package.json"
  ];

  installCheckExtra = ''
    export HOME="$PWD/installCheckHome"
    mkdir -p "$HOME"

    assertExecutableSet "$packageRoot/bin" run
    test ! -e "$packageRoot/node_modules/oclif"
    test ! -e "$packageRoot/node_modules/cli-ux"

    node --input-type=module - "$out/bin/hackmd-cli" "$packageRoot" <<'JS'
    import assert from 'node:assert/strict';
    import {execFile} from 'node:child_process';
    import {once} from 'node:events';
    import {createServer} from 'node:http';
    import {createRequire} from 'node:module';
    import {promisify} from 'node:util';

    const [binary, root] = process.argv.slice(2);
    const require = createRequire(root + '/package.json');
    const config = await require('@oclif/core').Config.load(root);
    for (const name of config.pjson.oclif.plugins)
      assert(config.plugins.some(plugin => plugin.name === name), 'missing plugin: ' + name);
    for (const id of Object.keys(require('./oclif.manifest.json').commands))
      assert(config.commandIDs.includes(id), 'missing command: ' + id);
    for (const command of config.commands) assert.equal(typeof await command.load(), 'function');
    console.log('Loaded all ' + config.commands.length + ' commands and declared plugins');

    const user = {id: 'fixture-user'};
    const note = {id: 'fixture-note', title: 'Nix fixture', content: '# Offline fixture'};
    const routes = new Map([['/v1/me', user], ['/v1/notes', [note]], ['/v1/notes/fixture-note', note]]);
    const server = createServer((request, response) => {
      assert.equal(request.method, 'GET');
      const authorized = request.headers.authorization === 'Bearer fixture-token';
      response.writeHead(authorized ? 200 : 401, {'content-type': 'application/json'});
      response.end(JSON.stringify(authorized ? routes.get(request.url) : {message: 'Unauthorized'}));
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const run = promisify(execFile);
    const cli = (args, token = 'fixture-token') => run(binary, args, {
      timeout: 10000,
      env: {HOME: process.env.HOME, HMD_API_ACCESS_TOKEN: token,
        HMD_API_ENDPOINT_URL: 'http://127.0.0.1:' + server.address().port + '/v1'},
    });
    try {
      assert.deepEqual(JSON.parse((await cli(['whoami', '--output=json', '--columns=id'])).stdout), [user]);
      assert.deepEqual(JSON.parse((await cli(['notes', '--output=json', '--columns=id,title'])).stdout),
        [{id: note.id, title: note.title}]);
      assert.equal((await cli(['export', '--noteId=' + note.id])).stdout.trim(), note.content);
      await assert.rejects(cli(['whoami'], 'invalid'), error =>
        Number.isInteger(error.code) && error.code > 0 && error.stderr.includes('credentials are correct'));
    } finally {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    JS
  '';

  meta = {
    homepage = "https://github.com/hackmdio/hackmd-cli";
    license = lib.licenses.mit;
    description = "Official HackMD command line tool";
  };
}
