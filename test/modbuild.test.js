'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { createModBuilder, applySteps, loadEdits } = require('../src/game/mod/build')
const { GameServer } = require('../src/game/server')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jr-mod-'))

test('mod build: edits replace text found the expected number of times', () => {
  const steps = [{ find: 'b\n', replace: 'B\nC\n', count: 1 }, { find: 'x', replace: 'y', count: 2 }]
  assert.equal(applySteps('a.as', 'a\r\nb\r\nx x\r\n', steps), 'a\nB\nC\ny y\n')
  assert.throws(() => applySteps('a.as', 'a\nb\nb\n', steps), /a\.as: expected 1 match, found 2 \(b\)/)
  assert.throws(() => applySteps('a.as', 'nothing', steps), /found 0/)
})

test('mod build: the recorded edits match build.sh and their id', () => {
  const E = loadEdits()
  const sh = fs.readFileSync(path.join(__dirname, '..', 'tools', 'game-mod', 'build.sh'), 'utf8')
  assert.deepEqual(E.classes, /^classes=(.*)$/m.exec(sh)[1].trim().split(','))
  const { id, ...body } = E
  const text = JSON.stringify(body, null, 1)
  assert.equal(id, crypto.createHash('sha1').update(text).digest('hex').slice(0, 10))
  for (const [rel, steps] of Object.entries(E.files)) {
    assert.ok(steps.length, rel)
    for (const s of steps) assert.ok(s.find && s.count >= 1, rel)
  }
  // JR's own window classes go in with the bridge.
  assert.ok(E.files['XtReplyDemuxer.as'].some(s => s.replace.includes('class JRColorPicker')))
})

test('mod build: a failed build is reported once and the game carries on', async () => {
  const logs = []
  let tries = 0
  const b = createModBuilder({
    toolsDir: tmp(),
    outDir: tmp(),
    log: (e) => logs.push(e),
    getTools: async () => { tries++; throw new Error('no network') }
  })
  assert.equal(await b.build({ version: '1830', antiIdle: false, baseFile: 'x.swf' }), null)
  assert.equal(await b.build({ version: '1830', antiIdle: false, baseFile: 'x.swf' }), null)
  assert.equal(tries, 1)
  assert.match(logs.find(l => l.type === 'warn').message, /no network\. The game still works without them/)
})

test('mod build: decompile, edit, compile, check', async () => {
  const outDir = tmp()
  const calls = []
  const edits = { id: 'abc', classes: ['gui.Thing'], files: { 'gui/Thing.as': [{ find: 'old()', replace: 'jrAnchor();jrBigPalette();JRColorPicker', count: 1 }] } }
  const swf = require('../src/game/swf')
  const runImpl = async (cmd, args) => {
    calls.push(args)
    if (args.includes('-export')) {
      const dir = path.join(args[args.indexOf('script') + 1], 'scripts', 'gui')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'Thing.as'), 'x\r\nold()\r\n')
    } else {
      const mod = args[args.length - 1]
      const code = fs.readFileSync(path.join(mod, 'gui', 'Thing.as'))
      fs.writeFileSync(args[args.length - 2], swf.pack(10, Buffer.concat([Buffer.alloc(8), code])))
    }
    return ''
  }
  const logs = []
  const b = createModBuilder({ toolsDir: tmp(), outDir, edits, runImpl, log: (e) => logs.push(e), getTools: async () => ({ java: 'java', ffdec: '/t/ffdec-cli.jar' }) })
  assert.equal(b.file('1830', true), null)
  const f = await b.build({ version: '1830', antiIdle: true, baseFile: '/g/base.swf' })
  assert.equal(path.basename(f), 'ajclient-1830-awake-abc.swf')
  assert.equal(b.file('1830', true), f)
  assert.ok(calls[0].includes('gui.Thing'))
  assert.deepEqual(calls[1].slice(-3).slice(0, 1), ['/g/base.swf'])
  assert.deepEqual(fs.readdirSync(outDir), ['ajclient-1830-awake-abc.swf'])
  assert.ok(logs.some(l => l.type === 'success'))
})

test('mod build: the game server serves a build, and starts one when there is none', async () => {
  const cacheDir = tmp()
  const built = path.join(tmp(), 'built.swf')
  fs.writeFileSync(built, 'MOD')
  const started = []
  let ready = false
  const modBuilder = {
    file: (v, awake) => (ready && v === '1830' && awake ? built : null),
    build: async (job) => { started.push(job); return null }
  }
  const server = new GameServer({ proxyPort: () => 1, cacheDir, modBuilder, clientOptions: () => ({ antiIdle: true }) })
  ready = true
  assert.equal(String(await server.patchedClient('1830')), 'MOD')
  ready = false
  // No build yet and no game address: nothing to start from, nothing started.
  assert.equal(await server._buildMod('1830', { antiIdle: true }), null)
  // With a base file already prepared, the build starts from it.
  fs.writeFileSync(path.join(cacheDir, 'ajclient-1830-base-awake.swf'), 'BASE')
  await server._buildMod('1830', { antiIdle: true })
  assert.deepEqual(started, [{ version: '1830', antiIdle: true, baseFile: path.join(cacheDir, 'ajclient-1830-base-awake.swf') }])
})
