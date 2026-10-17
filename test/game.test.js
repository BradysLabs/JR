'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const net = require('net')
const asar = require('../src/game/asar')
const install = require('../src/game/install')
const { GameServer, upstreamFrom, publicHost, serverName } = require('../src/game/server')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jr-game-'))

// A stand-in for the official app, with the exact lines JR patches.
const FAKE = {
  'config.js': 'module.exports = {\n  noUpdater: false,\n  pluginPath: "../../",\n};\n',
  'index.js': 'const {app} = require("electron");\nconst config = require("./config.js");\nconsole.log(config);\n',
  'gui/components/GameScreen.js': '"use strict";\n(() => {\n  this.webViewElem.send("flashVarsReady", flashVars);\n})();\n',
  'gui/index.html': '<html></html>',
  'package.json': '{"name":"aj-classic","version":"1.5.7"}'
}

function fakeOfficial () {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, 'resources'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'AJ Classic.exe'), 'exe')
  fs.writeFileSync(path.join(dir, 'pepflashplayer.dll'), 'flash')
  fs.writeFileSync(path.join(dir, 'Uninstall AJ Classic.exe'), 'bye')
  fs.mkdirSync(path.join(dir, 'locales'))
  fs.writeFileSync(path.join(dir, 'locales', 'en-US.pak'), 'pak')
  asar.write(path.join(dir, 'resources', 'app.asar'), Object.entries(FAKE).map(([p, t]) => [p, Buffer.from(t)]))
  return dir
}

test('asar: write then read back', () => {
  const file = path.join(tmp(), 'a.asar')
  asar.write(file, [['a.txt', Buffer.from('hello')], ['dir/b.js', Buffer.from('x'.repeat(1001))], ['empty', Buffer.alloc(0)]])
  const a = asar.open(file)
  assert.deepEqual(a.list().sort(), ['a.txt', 'dir/b.js', 'empty'])
  assert.equal(a.read('a.txt').toString(), 'hello')
  assert.equal(a.read('dir/b.js').length, 1001)
  assert.equal(a.read('empty').length, 0)
  assert.throws(() => a.read('nope'), /not in the archive/)
  a.close()
})

test('game copy: built once, patched, rebuilt when AJ updates', () => {
  const official = fakeOfficial()
  const gameDir = path.join(tmp(), 'game')
  const first = install.ensureGame({ officialDir: official, gameDir })
  assert.equal(first.rebuilt, true)
  assert.ok(fs.existsSync(path.join(gameDir, 'AJ Classic.exe')))
  assert.ok(fs.existsSync(path.join(gameDir, 'pepflashplayer.dll')))
  assert.ok(fs.existsSync(path.join(gameDir, 'locales', 'en-US.pak')))
  assert.ok(!fs.existsSync(path.join(gameDir, 'Uninstall AJ Classic.exe')))

  const a = asar.open(path.join(gameDir, 'resources', 'app.asar'))
  assert.match(a.read('config.js').toString(), /noUpdater: true/)
  assert.match(a.read('index.js').toString(), /config\.jrApi = arg\('jr-api'\)/)
  const screen = a.read('gui/components/GameScreen.js').toString()
  assert.match(screen, /window\.jrPrepare = async/)
  assert.match(screen, /window\.jrPrepare\(flashVars\)\.then/)
  assert.equal(a.read('gui/index.html').toString(), '<html></html>')
  a.close()
  // The patched files are still valid JavaScript.
  assert.doesNotThrow(() => new Function(screen))

  assert.equal(install.ensureGame({ officialDir: official, gameDir }).rebuilt, false)
  // AJ updates itself
  fs.appendFileSync(path.join(official, 'AJ Classic.exe'), '2')
  assert.equal(install.ensureGame({ officialDir: official, gameDir }).rebuilt, true)
})

test('game copy: a changed AJ is reported, not half-patched', () => {
  const official = fakeOfficial()
  const p = path.join(official, 'resources', 'app.asar')
  const files = Object.entries(FAKE).map(([k, t]) => [k, Buffer.from(k === 'config.js' ? 'module.exports = {}' : t)])
  asar.write(p, files)
  const gameDir = path.join(tmp(), 'game')
  assert.throws(() => install.ensureGame({ officialDir: official, gameDir }), /AJ Classic has changed \(config\.js\)/)
  assert.ok(!fs.existsSync(gameDir))
})

test('the real AJ Classic app.asar patches cleanly (if available)', { skip: !process.env.AJ_ASAR }, () => {
  const { files } = install.patchedArchive(process.env.AJ_ASAR)
  const get = (p) => files.find(([q]) => q === p)[1].toString()
  assert.match(get('config.js'), /noUpdater: true/)
  assert.doesNotThrow(() => new Function(get('gui/components/GameScreen.js')))
})

test('upstream address from flashvars', () => {
  assert.deepEqual(upstreamFrom({ ingressXt: 'lb-iss04-classic-prod.animaljam.com:443', smartfoxServer: 'x' }), { host: 'lb-iss04-classic-prod.animaljam.com', port: 443 })
  assert.deepEqual(upstreamFrom({ smartfoxServer: 'iss02-classic.prod.animaljam.internal', smartfoxPort: '443' }), { host: 'lb-iss02-classic-prod.animaljam.com', port: 443 })
  assert.equal(publicHost('example.com'), 'example.com')
  assert.equal(publicHost('iss01-classic-prod.animaljam.com'), 'lb-iss01-classic-prod.animaljam.com')
  assert.equal(publicHost('lb-iss01-classic-prod.animaljam.com'), 'lb-iss01-classic-prod.animaljam.com')
  assert.equal(serverName('lb-iss02-classic-prod.animaljam.com'), 'iss02')
  assert.throws(() => upstreamFrom({}), /No game server/)
})

async function startOrigin () {
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push(req.method + ' ' + req.url)
    if (req.url.includes('ajclient.swf')) {
      res.writeHead(200)
      return res.end(fs.existsSync('/root/jr/assets/flash/ajclient.swf') ? fs.readFileSync('/root/jr/assets/flash/ajclient.swf') : Buffer.from('nope'))
    }
    if (req.method === 'POST') {
      let b = ''
      req.on('data', c => { b += c })
      req.on('end', () => { res.writeHead(201, { 'X-Test': 'yes' }); res.end('got ' + b) })
      return
    }
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end('PNGDATA')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, hits, base: `http://127.0.0.1:${server.address().port}` }
}

test('game server: session swap, content pass-through, patched client', async () => {
  const origin = await startOrigin()
  const logs = []
  const gs = new GameServer({ proxyPort: () => 52814, cacheDir: tmp(), log: e => logs.push(e) })
  await gs.listen()
  try {
    assert.throws(() => gs.upstream(), /hasn't logged in/)
    const session = await fetch(gs.url + '/game/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        smartfoxServer: 'iss02-classic.prod.animaljam.internal',
        smartfoxServer1: 'iss03-classic.prod.animaljam.internal',
        smartfoxPort: '443',
        content: origin.base + '/game/',
        mdUrl: origin.base + '/jammercentral/',
        deploy_version: '1712',
        clientURL: origin.base + '/game/1712/ajclient.swf?v=9'
      })
    }).then(r => r.json())
    assert.deepEqual(session, {
      smartfoxServer: '127.0.0.1',
      smartfoxPort: '52814',
      ingressXt: '127.0.0.1:52814',
      smartfoxServer1: '127.0.0.1',
      content: gs.url + '/content/',
      mdUrl: gs.url + '/md/',
      clientURL: gs.url + '/client/1712/ajclient.swf'
    })
    assert.deepEqual(gs.upstream(), { host: 'lb-iss02-classic-prod.animaljam.com', port: 443 })

    const img = await fetch(gs.url + '/content/1712/rooms/a.png?x=1')
    assert.equal(img.status, 200)
    assert.equal(img.headers.get('content-type'), 'image/png')
    assert.equal(await img.text(), 'PNGDATA')
    assert.ok(origin.hits.includes('GET /game/1712/rooms/a.png?x=1'))

    const post = await fetch(gs.url + '/md/api/thing', { method: 'POST', body: 'hello' })
    assert.equal(post.status, 201)
    assert.equal(await post.text(), 'got hello')

    assert.equal(await fetch(gs.url + '/crossdomain.xml').then(r => r.text()).then(t => /allow-access-from/.test(t)), true)
    assert.equal((await fetch(gs.url + '/nothing')).status, 404)

    if (fs.existsSync('/root/jr/assets/flash/ajclient.swf')) {
      const swfRes = await fetch(gs.url + '/client/1712/ajclient.swf')
      assert.equal(swfRes.status, 200)
      const body = Buffer.from(await swfRes.arrayBuffer())
      assert.equal(body.toString('latin1', 0, 3), 'CWS')
      // Cached: the origin is asked once.
      await fetch(gs.url + '/client/1712/ajclient.swf')
      assert.equal(origin.hits.filter(h => h.includes('ajclient.swf')).length, 1)
    }
  } finally {
    await gs.close()
    origin.server.close()
  }
})

test('game server only listens on this computer', async () => {
  const gs = new GameServer({ proxyPort: () => 1, cacheDir: tmp() })
  await gs.listen()
  assert.equal(gs.server.address().address, '127.0.0.1')
  await gs.close()
  assert.ok(net)
})
