'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Dispatch } = require('../src/engine/dispatch')
const { decode } = require('../src/engine/codec')
const { ShopService } = require('../plugins/shop-restocker/shop')
const R = require('../plugins/shop-restocker/recycle')

const map = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]))

test('recycle plan: only what the preset names, never worn, in a shop or placed', () => {
  const inventory = {
    clothing: map({ 1: { defId: 857 }, 2: { defId: 857 }, 3: { defId: 857, equipped: true }, 4: { defId: 857, shop: 151 }, 5: { defId: 439 } }),
    den: map({ 20: { defId: 994 }, 21: { defId: 994, placed: true }, 30: { defId: 3993, stand: true }, 31: { defId: 777, mannequin: true } })
  }
  const plan = R.planRecycle(inventory, [{ kind: 'clothing', defId: 857 }, { kind: 'den', defId: 994 }, { kind: 'den', defId: 3993 }, { kind: 'den', defId: 777 }])
  assert.deepEqual(plan.recycle.map(r => `${r.kind}:${r.slot}`).sort(), ['clothing:1', 'clothing:2', 'den:20'])
  const e = plan.byEntry.find(x => x.key === 'clothing:857')
  assert.deepEqual([e.owned, e.safe, e.recycle], [4, 2, 2])
})

test('recycle plan: keep counts every copy you own, protected ones first', () => {
  const inventory = { clothing: map({ 1: { defId: 857 }, 2: { defId: 857 }, 3: { defId: 857 }, 4: { defId: 857, equipped: true } }), den: new Map() }
  const slots = (keep) => R.planRecycle(inventory, [{ kind: 'clothing', defId: 857, keep }]).recycle.map(r => r.slot)
  assert.deepEqual(slots(0), [3, 2, 1])
  assert.deepEqual(slots(1), [3, 2, 1]) // the worn one is the one you keep
  assert.deepEqual(slots(2), [3, 2]) // newest go first
  assert.deepEqual(slots(4), [])
  assert.deepEqual(slots(9), [])
})

test('recycle packets and shared presets', () => {
  assert.equal(R.recyclePacket('55', { kind: 'clothing', slot: 9 }), '%xt%o%ir%55%9%')
  assert.equal(R.recyclePacket('55', { kind: 'den', slot: 9 }), '%xt%o%dr%55%0%9%')
  assert.throws(() => R.recyclePacket(null, { kind: 'den', slot: 9 }), /Join a room/)
  const code = R.encodePreset({ name: 'Gem Farm junk', items: [{ kind: 'clothing', defId: 857, keep: 1 }, { kind: 'clothing', defId: 857 }, { kind: 'pet', defId: 1 }] })
  assert.match(code, /^JR-RECYCLE:/)
  assert.deepEqual(R.decodePreset(`here you go ${code} enjoy`), { name: 'Gem Farm junk', items: [{ kind: 'clothing', defId: 857, keep: 1 }] })
  assert.throws(() => R.decodePreset('hello'), /isn.t a JR recycle preset/)
})

// Same inventory as the shop tests: Headdress ×2 (slots 10, 11), Collar worn (12) and spare (13);
// den: My Shop stand (151, placed), Lamp in storage (20) and placed (21).
const IL = '%xt%il%-1%0%1%1%Seller%0%8%4%439%10%5%0%0%439%11%5%0%0%60%12%9%1%0%60%13%9%0%0%'
const DI = '%xt%di%-1%0%3%0%151%3993%1%0%true%%0%%0%20%994%0%2%true%%0%%0%21%994%1%2%true%%0%%0%'

function setup () {
  const d = new Dispatch()
  const sent = []
  d.session = { toServer: (t) => sent.push(t), toGame: () => {} }
  d.setState('player', { userName: 'Seller' })
  d.setState('room', '7882775')
  const den = new Map([['3993', { name: 'My Shop', specialType: 5 }], ['994', { name: 'Lamp' }]])
  const clothing = new Map([['439', { name: 'Headdress' }], ['60', { name: 'Collar' }], ['857', { name: 'Prize Hat' }]])
  const items = { getDenItem: (id) => den.get(String(id)) || null, getClothing: (id) => clothing.get(String(id)) || null }
  const s = new ShopService({ dispatch: d, items, storage: { get: (k, f) => f, set: () => {} }, wait: async () => {} })
  return { d, s, sent, server: (t) => d.process(decode(t, 'in')) }
}

test('recycle tool: inventory, one-click recycle, and a log', async () => {
  const { s, sent, server } = setup()
  await server(IL)
  await server(DI)
  const inv = s.inventory()
  assert.deepEqual(inv.ready, { clothing: true, den: true })
  assert.deepEqual(inv.items.find(i => i.kind === 'clothing' && i.defId === 60), { kind: 'clothing', defId: 60, name: 'Collar', owned: 2, free: 1 })
  assert.deepEqual(inv.items.find(i => i.kind === 'den' && i.defId === 994), { kind: 'den', defId: 994, name: 'Lamp', owned: 2, free: 1 })

  const preset = [{ kind: 'clothing', defId: 60 }, { kind: 'clothing', defId: 439, keep: 1 }, { kind: 'den', defId: 994 }, { kind: 'den', defId: 3993 }]
  const plan = s.planRecycle(preset)
  assert.equal(plan.recycle.length, 3)
  const r = await s.recycleNow(preset)
  assert.equal(r.recycled, 3)
  assert.deepEqual(sent.slice().sort(), ['%xt%o%dr%7882775%0%20%', '%xt%o%ir%7882775%11%', '%xt%o%ir%7882775%13%'])
  assert.equal(r.what, 'Collar, Headdress, Lamp')
  // Gone from what JR knows, so a second click does nothing.
  assert.equal((await s.recycleNow(preset)).recycled, 0)
  assert.equal(s.recycleSnapshot().log[0].count, 3)
})

test('recycle tool: auto-recycle picks up prizes as they arrive', async () => {
  const { s, sent, server } = setup()
  await server(IL)
  await server(DI)
  s.setAutoRecycle({ name: 'Gem Farm junk', entries: [{ kind: 'clothing', defId: 857 }, { kind: 'den', defId: 994, keep: 1 }] })
  assert.deepEqual(s.recycleSnapshot().auto, { name: 'Gem Farm junk', count: 2 })
  // A prize hat arrives (slot 40), and something else (slot 41).
  await server('%xt%il%-1%2%1%1%Seller%5%1%0%40%857%')
  await server('%xt%il%-1%2%1%1%Seller%5%1%0%41%439%')
  // A new Lamp arrives in the den list (slot 22); you already keep one in storage.
  await server('%xt%di%-1%0%4%0%151%3993%1%0%true%%0%%0%20%994%0%2%true%%0%%0%21%994%1%2%true%%0%%0%22%994%0%2%true%%0%%0%')
  await new Promise(r => setTimeout(r, 800))
  assert.deepEqual(sent.slice().sort(), ['%xt%o%dr%7882775%0%22%', '%xt%o%ir%7882775%40%'])
  // Off: nothing more.
  s.setAutoRecycle(null)
  await server('%xt%il%-1%2%1%1%Seller%5%1%0%42%857%')
  await new Promise(r => setTimeout(r, 400))
  assert.equal(sent.length, 2)
})
