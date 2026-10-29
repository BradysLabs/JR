'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { GameServer } = require('../src/game/server')

test('in-game panel: only the token JR gave the game gets in', async () => {
  const calls = []
  const gs = new GameServer({ proxyPort: () => 1, cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jr-ingame-')) })
  gs.ingame = {
    state: () => ({ version: '0.1.0', connected: true, plugins: [] }),
    action: async (body) => { calls.push(body); if (body.action === 'bad') throw new Error('Unknown action.'); return { ok: true } }
  }
  await gs.listen()
  try {
    assert.match(gs.token, /^[0-9a-f]{48}$/)
    const u = (p, t) => `${gs.url}${p}${t === undefined ? '' : `?t=${t}`}`
    assert.equal((await fetch(u('/jr/ingame/state'))).status, 403)
    assert.equal((await fetch(u('/jr/ingame/state', 'wrong'))).status, 403)
    assert.equal((await fetch(u('/jr/ingame/state', gs.token.slice(0, -1) + 'x'))).status, 403)

    const ok = await fetch(u('/jr/ingame/state', gs.token))
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('access-control-allow-origin'), '*')
    assert.deepEqual(await ok.json(), { version: '0.1.0', connected: true, plugins: [] })

    const post = (body, t = gs.token) => fetch(u('/jr/ingame/action', t), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await post({ action: 'openPlugin', id: 'x' }, 'nope')).status, 403)
    assert.equal(calls.length, 0) // refused before reaching JR
    const done = await post({ action: 'openPlugin', id: 'room-browser' })
    assert.equal(done.status, 200)
    assert.deepEqual(calls, [{ action: 'openPlugin', id: 'room-browser' }])
    const bad = await post({ action: 'bad' })
    assert.equal(bad.status, 400)
    assert.deepEqual(await bad.json(), { error: 'Unknown action.' })
    assert.equal((await fetch(u('/jr/ingame/nothing', gs.token))).status, 404)
  } finally {
    await gs.close()
  }
})

test('in-game panel: two launches never share a token', () => {
  const a = new GameServer({ proxyPort: () => 1, cacheDir: os.tmpdir() })
  const b = new GameServer({ proxyPort: () => 1, cacheDir: os.tmpdir() })
  assert.notEqual(a.token, b.token)
})
