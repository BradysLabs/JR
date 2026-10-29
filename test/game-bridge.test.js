'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Dispatch } = require('../src/engine/dispatch')
const { decode } = require('../src/engine/codec')
const { createGameBridge, worthText, field } = require('../src/game/bridge')
const { GameServer } = require('../src/game/server')

function setup (overrides = {}) {
  const dispatch = new Dispatch({ packetsPerSecond: 100 })
  const toGame = []
  const toServer = []
  dispatch.session = { toGame: (t) => toGame.push(t), toServer: (t) => toServer.push(t) }
  const calls = []
  createGameBridge({
    dispatch,
    rows: () => [{ k: 'antiKick', l: 'JR Anti-Kick', f: 'autoServer', v: true }],
    toggle: (k, v) => calls.push(['toggle', k, v]),
    press: (k) => calls.push(['press', k]),
    worth: async (q) => { calls.push(['worth', q]); return { found: true, matched: true, name: 'Spiked Wristband', scope: 'color', color: 'Black', diamonds: { min: 400, max: 500 }, bl: 1, lines: ['Rare · 1 BLC'], more: 0, updated: '2026-10-01' } },
    ...overrides
  })
  return { dispatch, toGame, toServer, calls }
}

const fromGame = (d, text) => d.process(decode(text, 'out'))
const reply = (text) => { const p = text.replace(/\0$/, '').split('%'); return { kind: p[4], value: JSON.parse(p[5]) } }

test('bridge: JR messages from the game never reach Animal Jam', async () => {
  const { dispatch, toGame } = setup()
  const packet = await fromGame(dispatch, '%xt%o%jr%5%s%')
  assert.equal(packet.send, false)
  assert.deepEqual(toGame.map(t => reply(t).kind), ['s', 'p', 'a'])
  const r = reply(toGame[0])
  assert.equal(r.kind, 's')
  assert.deepEqual(r.value, [{ k: 'antiKick', l: 'JR Anti-Kick', f: 'autoServer', v: true }])
})

test('bridge: a switched row changes the setting and resends rows', async () => {
  const { dispatch, toGame, calls } = setup()
  await fromGame(dispatch, '%xt%o%jr%5%t%antiKick%0%')
  assert.deepEqual(calls, [['toggle', 'antiKick', false]])
  assert.deepEqual(toGame.map(t => reply(t).kind), ['s', 'p', 'a', 'c'])
  await fromGame(dispatch, '%xt%o%jr%5%a%showJR%')
  assert.deepEqual(calls[1], ['press', 'showJR'])
})

test('bridge: hovering an item gets its worth back', async () => {
  const { dispatch, toGame, calls } = setup()
  await fromGame(dispatch, '%xt%o%jr%5%w%c123_4%c%123%4%Spiked Wristband · 400-500 Diamonds%')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls[0], ['worth', { kind: 'clothing', defId: 123, color: 4, name: 'Spiked Wristband · 400-500 Diamonds' }])
  const r = reply(toGame[0])
  assert.equal(r.kind, 'w')
  assert.equal(r.value.k, 'c123_4')
  assert.equal(r.value.t, 'Spiked Wristband')
  assert.ok(r.value.b.includes('≈ 400–500 Diamonds'))
})

test('bridge: room joins push the rows, other packets pass', async () => {
  const { dispatch, toGame } = setup()
  const p = await fromGame(dispatch, '%xt%o%rj%5%denName%')
  assert.equal(p.send, true)
  await dispatch.process(decode('%xt%rj%-1%1%denName%5%', 'in'))
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(reply(toGame[0]).kind, 's')
})

test('bridge: the Streaming Mode name is saved from the game and sent back', async () => {
  let saved = 'Old'
  const { dispatch, toGame } = setup({ profile: () => ({ name: saved, saved }), rename: (n) => { saved = n } })
  await fromGame(dispatch, '%xt%o%jr%5%n%Coolcat 99%')
  assert.equal(saved, 'Coolcat 99')
  assert.deepEqual(reply(toGame[1]), { kind: 'p', value: { name: 'Coolcat 99', saved: 'Coolcat 99' } })
  await fromGame(dispatch, '%xt%o%jr%5%n%-%')
  assert.equal(saved, '')
})

test('bridge: text with % stays in one field', () => {
  assert.ok(!field({ t: '100% rare' }).includes('%'))
  assert.equal(JSON.parse(field({ t: '100% rare' })).t, '100% rare')
  assert.deepEqual(worthText('x', { found: false }), { k: 'x', off: 1 })
})

test('server: serves JR’s in-game build when there is one for the version', async () => {
  const mods = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-mods-'))
  fs.writeFileSync(path.join(mods, 'ajclient-1830.swf'), 'MOD')
  fs.writeFileSync(path.join(mods, 'ajclient-1830-awake.swf'), 'MOD-AWAKE')
  let antiIdle = false
  const gs = new GameServer({ proxyPort: () => 1, cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jr-c-')), modsDir: mods, clientOptions: () => ({ antiIdle }) })
  assert.equal(String(await gs.patchedClient('1830')), 'MOD')
  antiIdle = true
  assert.equal(String(await gs.patchedClient('1830')), 'MOD-AWAKE')
  assert.equal(gs.modded, true)
  assert.equal(gs.moddedClient('1831', {}), null)
})

test('bridge: the More Sorts menu gets the worth of your items', async () => {
  const { dispatch, toGame } = setup({ worthMap: () => ({ c12_5: 300, d9: 40 }) })
  await fromGame(dispatch, '%xt%o%jr%5%k%')
  const r = reply(toGame[0])
  assert.equal(r.kind, 'k')
  assert.deepEqual(r.value, { c12_5: 300, d9: 40 })
})
