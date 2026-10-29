'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createSurfaces, fileStore } = require('../src/game/surfaces')

const ROOT = path.join(__dirname, '..')
const TYPES = new Set(['h', 'p', 'kv', 'sep', 'btn', 'row', 'tog', 'in', 'chips', 'sw', 'num', 'li'])
const ALL = ['wardrobe', 'shop', 'buying', 'social', 'play', 'tools'].flatMap(n => require(`../src/game/surfaces/${n}`))

function fakeDispatch () {
  const state = { room: '55', roomName: 'jamaa_township.room_main#1' }
  const sent = []
  return {
    sent,
    connected: true,
    getState: (k) => state[k],
    setState: (k, v) => { state[k] = v },
    onMessage () {},
    offMessage () {},
    on () {},
    sendRemoteMessage: async (t) => { sent.push(['server', t]) },
    sendConnectionMessage: (t) => { sent.push(['game', t]) },
    runCommand: async () => true
  }
}

function setup (enabled = () => true) {
  const out = []
  const dispatch = fakeDispatch()
  const items = { ready: false, clothing: new Map([['1', { name: 'Spiked Wristband' }]]), getClothing: (id) => (String(id) === '1' ? { name: 'Spiked Wristband' } : null), getDenItem: () => null, name: () => null, deployVersion: null, load: async () => {}, fetchPack: async () => ({}) }
  const settings = { antiKick: false }
  const surfaces = createSurfaces({
    bridge: { send: (kind, value) => out.push({ kind, value }) },
    enabled,
    surfaces: ALL,
    ctx: {
      dispatch,
      items,
      log () {},
      application: {},
      root: ROOT,
      profileDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jr-surfaces-')),
      version: 'test',
      settings: () => settings,
      updateSettings: (p) => Object.assign(settings, p),
      mask: (t) => t,
      recentRooms: () => [{ name: 'denbob' }],
      shopApi: () => null,
      openPlugin () {},
      focusJR () {},
      pricer: () => ({ value: () => ({}), format: () => '≈ 1 Diamonds' }),
      membership: () => true,
      setMembership () {},
      surfaceEnabled: () => true
    }
  })
  return { surfaces, out, dispatch, settings }
}

test('surfaces: every plugin has a window, and each window draws only known parts', async () => {
  const { surfaces, out } = setup()
  for (const id of surfaces.ids()) {
    out.length = 0
    surfaces.open({ s: id, a: 'test', x: {} })
    await new Promise(resolve => setImmediate(resolve))
    const v = out.find(o => o.kind === 'v' && o.value.open)
    assert.ok(v, `${id} opened`)
    assert.ok(v.value.title, `${id} has a title`)
    for (const row of v.value.rows || []) assert.ok(TYPES.has(row.t), `${id}: unknown row ${row.t}`)
    assert.ok(!(v.value.rows || []).some(r => /Couldn’t show this/.test(r.text || '')), `${id} drew without errors`)
  }
})

test('surfaces: game screens get buttons, and turned-off plugins lose theirs', () => {
  const all = setup().surfaces.anchors()
  assert.deepEqual(all.avatar.b.map(b => b.l), ['Worth'])
  assert.deepEqual(all.avatarinv.b.map(b => b.l), ['Save Outfit', 'Try On'])
  assert.deepEqual(all.avatarcolors.b.map(b => b.l), ['Glow'])
  assert.ok(!all.chat && !all.hud, 'chat bar and map get the game-style buttons instead')
  assert.deepEqual(all.artstudio.b, [{ id: 'picture', l: 'Picture', i: 'picture', local: 'picture' }])
  const some = setup((id) => id !== 'glow-picker').surfaces.anchors()
  assert.ok(!some.avatarcolors)
})

test('surfaces: clicks reach the plugin and the window updates once', async () => {
  const { surfaces, out, dispatch, settings } = setup()
  surfaces.open({ s: 'menu', a: 'hud', x: {} })
  surfaces.event({ p: 'menu', c: 'antiKick', v: '1', i: {} })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(settings.antiKick, true)
  const before = out.length
  surfaces.event({ p: 'rooms', c: '_tab', v: 'recent', i: {} })
  surfaces.open({ s: 'rooms', a: 'hud', x: {} })
  surfaces.event({ p: 'rooms', c: 'go', v: 'denbob', i: {} })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(dispatch.sent.pop(), ['server', '%xt%o%dj%55%denbob%1%-1%'])
  assert.ok(out.slice(before).some(o => o.kind === 'x' && o.value.id === 'rooms'))
})

test('surfaces: errors become a message in the game', async () => {
  const { surfaces, out } = setup()
  surfaces.open({ s: 'outfits', a: 'avatar', x: {} })
  surfaces.event({ p: 'outfits', c: 'name', v: 'Party', i: {} })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.match(out.filter(o => o.kind === 'm').pop().value.text, /My Shop Restocker/)
})

test('surfaces: plugin data is shared with the plugin window', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-store-'))
  fs.writeFileSync(path.join(dir, 'storage.json'), JSON.stringify({ outfits: [{ name: 'A' }] }))
  const store = fileStore(dir)
  assert.equal(store.get('outfits')[0].name, 'A')
  store.set('x', 1)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'storage.json'), 'utf8')).x, 1)
})
