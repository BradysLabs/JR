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
  'index.js': 'const {app} = require("electron");\nconst config = require("./config.js");\nconst w = { backgroundColor: "#F5C86D" };\n',
  'gui/components/GameScreen.js': '"use strict";\n(() => {\n  this.webViewElem.addEventListener("ipc-message", async event => {\n  });\n  this.webViewElem.send("flashVarsReady", flashVars);\n})();\n',
  'gui/gamePreload.js': '"use strict";\nconst { ipcRenderer, contextBridge } = require("electron");\nipcRenderer.on("redirect-url", (event, url) => {\n});\n',
  'gui/index.html': '<html><head><title>Animal Jam Classic</title></head></html>',
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
  const base = path.join(tmp(), 'game')
  const first = install.ensureGame({ officialDir: official, gameDir: base, platform: 'win32' })
  assert.equal(first.rebuilt, true)
  const gameDir = first.gameDir
  assert.ok(gameDir.startsWith(base + '-'))
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
  assert.match(screen, /window\.jrWatchGame = \(screen\) =>/)
  assert.match(screen, /try \{ window\.jrWatchGame\(this\); \}/)
  const preload = a.read('gui/gamePreload.js').toString()
  assert.match(preload, /exposeInMainWorld\("jrItemOver"/)
  assert.match(preload, /exposeInMainWorld\("jrItemOut"/)
  assert.match(preload, /exposeInMainWorld\("jrSettingsRows"/)
  assert.match(preload, /exposeInMainWorld\("jrSettingToggle"/)
  assert.doesNotThrow(() => new Function(preload))
  assert.match(a.read('gui/index.html').toString(), /<title>JR<\/title>\s*<script src="jr-skin.js"><\/script>\s*<script src="jr-ingame.js"><\/script>/)
  assert.match(a.read('gui/jr-ingame.js').toString(), /window\.jrIngame = \{/)
  assert.match(a.read('index.js').toString(), /config\.jrToken = arg\('jr-token'\)/)
  assert.doesNotThrow(() => new Function(a.read('index.js').toString().replace('const {app} = require("electron");', 'const app = { on () {} };')))
  assert.match(a.read('gui/jr-skin.js').toString(), /attachShadow/)
  assert.match(a.read('index.js').toString(), /#0b0b0c/)
  assert.ok(a.read('gui/images/icon.png').length > 1000)
  a.close()
  // The patched files are still valid JavaScript.
  assert.doesNotThrow(() => new Function(screen))

  assert.equal(install.ensureGame({ officialDir: official, gameDir: base, platform: 'win32' }).rebuilt, false)
  // AJ updates itself: a new copy in its own folder; the old one is removed.
  fs.appendFileSync(path.join(official, 'AJ Classic.exe'), '2')
  const second = install.ensureGame({ officialDir: official, gameDir: base, platform: 'win32' })
  assert.equal(second.rebuilt, true)
  assert.notEqual(second.gameDir, gameDir)
  assert.ok(fs.existsSync(path.join(second.gameDir, 'AJ Classic.exe')))
  assert.ok(!fs.existsSync(gameDir))
  // An older JR's plain folder is left alone.
  fs.mkdirSync(base)
  install.ensureGame({ officialDir: official, gameDir: base, platform: 'win32' })
  assert.ok(fs.existsSync(base))
})

test('game copy: a changed AJ is reported, not half-patched', () => {
  const official = fakeOfficial()
  const p = path.join(official, 'resources', 'app.asar')
  const files = Object.entries(FAKE).map(([k, t]) => [k, Buffer.from(k === 'config.js' ? 'module.exports = {}' : t)])
  asar.write(p, files)
  const gameDir = path.join(tmp(), 'game')
  assert.throws(() => install.ensureGame({ officialDir: official, gameDir, platform: 'win32' }), /AJ Classic has changed \(config\.js\)/)
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
      ingressXt: '',
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

/* ------------------------------------------------------------------ Mac */

// A stand-in for "AJ Classic.app": program in Contents/MacOS, the archive in
// Contents/Resources, framework symlinks, and the archive checksum in Info.plist.
// Mac app bundles need Mac file permissions and symlinks, so these run on
// Macs (and Linux), not Windows. GitHub's Mac build runs them.
const ON_WINDOWS = process.platform === 'win32' && 'Mac app bundles need Mac file permissions and symlinks'

function fakeMacApp (folder) {
  const app = path.join(folder, 'AJ Classic.app')
  const c = path.join(app, 'Contents')
  fs.mkdirSync(path.join(c, 'MacOS'), { recursive: true })
  fs.mkdirSync(path.join(c, 'Resources'), { recursive: true })
  const exe = path.join(c, 'MacOS', 'AJ Classic')
  fs.writeFileSync(exe, '#!/bin/sh\necho game\n')
  fs.chmodSync(exe, 0o755)
  const fw = path.join(c, 'Frameworks', 'Electron Framework.framework')
  fs.mkdirSync(path.join(fw, 'Versions', 'A'), { recursive: true })
  fs.writeFileSync(path.join(fw, 'Versions', 'A', 'Electron Framework'), 'fw')
  fs.symlinkSync('A', path.join(fw, 'Versions', 'Current'))
  fs.symlinkSync('Versions/Current/Electron Framework', path.join(fw, 'Electron Framework'))
  asar.write(path.join(c, 'Resources', 'app.asar'), Object.entries(FAKE).map(([p, t]) => [p, Buffer.from(t)]))
  fs.writeFileSync(path.join(c, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key>
  <string>AJ Classic</string>
  <key>ElectronAsarIntegrity</key>
  <dict>
    <key>Resources/app.asar</key>
    <dict>
      <key>algorithm</key>
      <string>SHA256</string>
      <key>hash</key>
      <string>${asar.headerHash(path.join(c, 'Resources', 'app.asar'))}</string>
    </dict>
  </dict>
</dict></plist>
`)
  return app
}

test('mac: finds AJ Classic in Applications (or ~/Applications), not other apps', { skip: ON_WINDOWS }, () => {
  const apps = tmp(); const userApps = tmp()
  assert.equal(install.findOfficial({ platform: 'darwin', appFolders: [apps, userApps] }), null)
  fs.mkdirSync(path.join(apps, 'Something Else.app'))
  const app = fakeMacApp(userApps)
  assert.equal(install.findOfficial({ platform: 'darwin', appFolders: [apps, userApps] }), app)
  assert.equal(install.macExecutable(app), 'AJ Classic')
  // Windows still looks in its own places.
  assert.equal(install.findOfficial({ platform: 'win32', env: {}, home: tmp() }), null)
})

test('mac: the copy stays a working app bundle: symlinks kept, archive patched, checksum updated, signed ad hoc', { skip: ON_WINDOWS }, () => {
  const official = fakeMacApp(tmp())
  const gameDir = path.join(tmp(), 'game')
  const ran = []
  const run = (cmd, args) => { ran.push([cmd, ...args].join(' ')); return '' }
  const r = install.ensureGame({ officialDir: official, gameDir, platform: 'darwin', run })
  assert.equal(r.rebuilt, true)
  assert.ok(r.gameDir.startsWith(gameDir + '-'))
  const app = path.join(r.gameDir, 'AJ Classic.app')
  assert.equal(r.exe, path.join(app, 'Contents', 'MacOS', 'AJ Classic'))
  assert.ok(fs.statSync(r.exe).mode & 0o100, 'program is still executable')
  // Framework symlinks are links, not copies (or missing).
  const fw = path.join(app, 'Contents', 'Frameworks', 'Electron Framework.framework')
  assert.equal(fs.readlinkSync(path.join(fw, 'Versions', 'Current')), 'A')
  assert.equal(fs.readlinkSync(path.join(fw, 'Electron Framework')), 'Versions/Current/Electron Framework')
  // Patched archive, and Info.plist now has its checksum.
  const asarFile = path.join(app, 'Contents', 'Resources', 'app.asar')
  const a = asar.open(asarFile)
  assert.match(a.read('config.js').toString(), /noUpdater: true/)
  a.close()
  const plist = fs.readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8')
  assert.ok(plist.includes(`<string>${asar.headerHash(asarFile)}</string>`))
  assert.ok(!plist.includes(`<string>${asar.headerHash(path.join(official, 'Contents', 'Resources', 'app.asar'))}</string>`))
  // Download flag cleared and signed ad hoc, so macOS will open it.
  // (done on the copy while it's being built, before it's moved into place)
  const building = path.join(`${r.gameDir}.building`, 'AJ Classic.app')
  assert.deepEqual(ran, [`xattr -cr ${building}`, `codesign --force --deep --sign - ${building}`])
  // Up to date the second time; rebuilt when AJ updates.
  assert.equal(install.ensureGame({ officialDir: official, gameDir, platform: 'darwin', run }).rebuilt, false)
  fs.appendFileSync(path.join(official, 'Contents', 'MacOS', 'AJ Classic'), '#2\n')
  assert.equal(install.ensureGame({ officialDir: official, gameDir, platform: 'darwin', run }).rebuilt, true)
})

test('mac: a signing failure is explained, and leaves no half-built copy', { skip: ON_WINDOWS }, () => {
  const official = fakeMacApp(tmp())
  const gameDir = path.join(tmp(), 'game')
  const run = (cmd) => { if (cmd === 'codesign') throw new Error('codesign failed: nope') }
  assert.throws(() => install.ensureGame({ officialDir: official, gameDir, platform: 'darwin', run }), /macOS wouldn't let JR prepare its copy/)
  assert.deepEqual(fs.readdirSync(path.dirname(gameDir)).filter(n => n.startsWith('game-') && !n.endsWith('.building')), [])
})

test('mac: no checksum in Info.plist is fine (the app doesn\'t check it)', { skip: ON_WINDOWS }, () => {
  const app = fakeMacApp(tmp())
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), '<?xml version="1.0"?><plist><dict><key>CFBundleExecutable</key><string>AJ Classic</string></dict></plist>')
  assert.equal(install.updateAsarIntegrity(app, path.join(app, 'Contents', 'Resources', 'app.asar'), () => {}), false)
})
