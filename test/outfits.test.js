'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Dispatch } = require('../src/engine/dispatch')
const { decode } = require('../src/engine/codec')
const { ShopService } = require('../plugins/shop-restocker/shop')

// Headdress ×2 (10, 11), Collar worn (12) and spare (13).
const IL = '%xt%il%-1%0%1%1%Seller%0%8%4%439%10%5%0%0%439%11%5%0%0%60%12%9%1%0%60%13%9%0%0%'
const LAYER = { 439: 'head', 60: 'neck', 1037: 'feet', 777: 'head' }

function setup () {
  const d = new Dispatch()
  const sent = []
  d.session = { toServer: (t) => sent.push(t), toGame: () => {} }
  d.setState('player', { userName: 'Seller' })
  d.setState('room', '1763249')
  const names = new Map([['439', 'Headdress'], ['60', 'Collar'], ['1037', 'Pumpkin Shoes']])
  const items = { getDenItem: () => null, getClothing: (id) => (names.has(String(id)) ? { name: names.get(String(id)) } : null) }
  const logs = []
  const s = new ShopService({ dispatch: d, items, storage: { get: (k, f) => f, set: () => {} }, wait: async () => {}, log: (m) => logs.push(m) })
  return { d, s, sent, logs, server: (t) => d.process(decode(t, 'in')), game: (t) => d.process(decode(t, 'out')) }
}

/**
 * A stand-in for Animal Jam's server, acting like the real one in a capture:
 * it puts things on BEFORE taking things off, and refuses to put something
 * on where another item is still worn. Answers iu with an il update + iu ok,
 * and ap with an ok (or "no" when refuseColors is set).
 */
function fakeServer (t, { refuseColors = false } = {}) {
  const worn = new Map() // slot -> defId
  for (const [slot, c] of t.s.clothing) if (c.equipped) worn.set(slot, c.defId)
  t.d.session.toServer = (text) => {
    t.sent.push(text)
    const v = text.split('%')
    setImmediate(async () => {
      if (v[3] === 'iu') {
        const on = Number(v[5]); const off = Number(v[6])
        const onList = v.slice(7, 7 + on).map(Number); const offList = v.slice(7 + on, 7 + on + off).map(Number)
        const okOn = []
        for (const slot of onList) {
          if (slot < 0) { okOn.push([slot, -slot]); continue }
          const c = t.s.clothing.get(slot)
          const clash = [...worn].some(([w, def]) => LAYER[def] === LAYER[c.defId])
          if (!clash) { worn.set(slot, c.defId); okOn.push([slot, c.defId]) }
        }
        for (const slot of offList) worn.delete(slot)
        await t.server(`%xt%il%-1%3%0%1%Seller%0%${okOn.length}%${offList.length}%${[...okOn.flat(), ...offList].join('%')}%`)
        await t.server(`%xt%iu%${v[4]}%1%`)
      }
      if (v[3] === 'ap') await t.server(`%xt%ap%${v[4]}%${refuseColors ? 0 : 1}%`)
    })
  }
}

test('wearing: JR keeps up when you put things on and take them off (real packets)', async () => {
  const { s, server } = setup()
  await server(IL)
  assert.deepEqual(s.currentOutfit().clothing.map(c => c.slot), [12])
  // From a real capture: Pumpkin Shoes bought into slot 1 and put on, then off, then on.
  await server('%xt%il%-1%2%1%1%Seller%781033632%1%0%1%1037%')
  await server('%xt%il%-1%3%0%1%Seller%0%1%0%1%1037%')
  assert.deepEqual(s.currentOutfit().clothing.map(c => c.slot).sort(), [1, 12])
  await server('%xt%il%-1%3%0%1%Seller%0%0%1%1%')
  assert.deepEqual(s.currentOutfit().clothing.map(c => c.slot), [12])
  // The Recycle Tool now sees the change: a worn item is safe.
  await server('%xt%il%-1%3%0%1%Seller%0%1%0%13%60%')
  assert.equal(s.planRecycle([{ kind: 'clothing', defId: 60 }]).recycle.length, 0)
})

test('look: eyes/pattern and colors are learned from what the game sends', async () => {
  const { s, server, game } = setup()
  await server(IL)
  assert.equal(s.currentOutfit().look, null)
  assert.equal(s.currentOutfit().colors, null)
  // Real capture: eyes/pattern 2 on (slot -2), 9 off (slot -9), then new colors.
  await server('%xt%il%-1%3%0%1%Seller%0%1%1%-2%2%-9%')
  await game('%xt%o%ap%1763249%1061101311%2358206403%318766847%0%')
  const o = s.currentOutfit()
  assert.deepEqual(o.look, [{ slot: -2, defId: 2 }])
  assert.deepEqual(o.colors, [1061101311, 2358206403, 318766847, 0])
})

test('outfits: takes off first, then puts on, so the server doesn\'t refuse items (real-capture bug)', async () => {
  const t = setup()
  const { s, d, sent, logs, server, game } = t
  await server(IL)
  await server('%xt%il%-1%3%0%1%Seller%0%1%0%-2%2%')
  await game('%xt%o%ap%1763249%1%2%3%0%')
  const saved = s.currentOutfit() // Collar (12), look -2, colors 1 2 3 0

  // Change into something else: Headdress (10) on, Collar off, look -9.
  await server('%xt%il%-1%3%0%1%Seller%0%2%2%10%439%-9%9%12%-2%')
  await game('%xt%o%ap%1763249%7%7%7%0%')
  d.setState('roomName', 'denseller')
  fakeServer(t)
  sent.length = 0
  const r = await s.wearOutfit(saved, { look: true }) // colors aren't used by the Outfits window any more, but still work underneath
  assert.deepEqual(sent, [
    '%xt%o%iu%1763249%0%1%10%', // Headdress off first
    '%xt%o%iu%1763249%2%1%12%-2%-9%', // then Collar and look -2 on, look -9 off
    '%xt%o%ap%1763249%1%2%3%0%',
    '%xt%o%dj%1763249%denseller%1%-1%' // rejoin so the colors show
  ])
  assert.deepEqual(r, { putOn: 2, tookOff: 2, recolored: true, colorRefused: false, reloaded: true, missing: [], notOn: [] })
  assert.deepEqual(s.currentOutfit().clothing.map(c => c.slot), [12])
  assert.ok(logs.some(l => /colors accepted/.test(l)) && logs.some(l => /rejoining denseller/.test(l)))
})

test('outfits: the old way (one packet, swapping a hat) gets refused, like the capture', async () => {
  const t = setup()
  await t.server(IL)
  await t.server('%xt%il%-1%3%0%1%Seller%0%1%0%11%439%') // wearing Headdress (11)
  fakeServer(t)
  // One packet: put Headdress (10) on, take Headdress (11) off. The server puts on first: refused.
  t.d.session.toServer('%xt%o%iu%1763249%1%1%10%11%')
  await new Promise(r => setTimeout(r, 20))
  assert.equal(t.s.clothing.get(10).equipped, false)
  assert.equal(t.s.clothing.get(11).equipped, false) // and the old one still came off
})

test('outfits: clothing only, items that moved slots, items you no longer have, and refused colors', async () => {
  const t = setup()
  const { s, sent, server, d } = t
  await server(IL)
  fakeServer(t)
  const outfit = { clothing: [{ slot: 99, defId: 439, color: 5 }, { slot: 50, defId: 777, name: 'Old Hat' }], look: [{ slot: -4, defId: 4 }], colors: [1, 1, 1, 0] }
  sent.length = 0
  const r = await s.wearOutfit(outfit, { clothing: true, look: false })
  // Headdress found in slot 10 by item and color; Collar (12) comes off first; look and colors untouched.
  assert.deepEqual(sent, ['%xt%o%iu%1763249%0%1%12%', '%xt%o%iu%1763249%1%0%10%'])
  assert.deepEqual(r.missing, ['Old Hat'])
  assert.equal(r.recolored, false)

  // Colors the server refuses: no rejoin, and reported.
  const t2 = setup()
  await t2.server(IL)
  fakeServer(t2, { refuseColors: true })
  t2.d.setState('roomName', 'jamaa_township.room_main#9')
  const r2 = await t2.s.wearOutfit({ clothing: [{ slot: 12, defId: 60 }], colors: [306180454, 25206960, 4227857663, 0] }, { look: true })
  assert.equal(r2.colorRefused, true)
  assert.equal(r2.reloaded, false)
  assert.ok(!t2.sent.some(p => p.includes('%rj%')))
})

test('outfits: clothes only by default, even for outfits saved with colors', async () => {
  const t = setup()
  await t.server(IL)
  fakeServer(t)
  t.d.setState('roomName', 'denseller')
  const r = await t.s.wearOutfit({ clothing: [{ slot: 10, defId: 439 }], look: [{ slot: -2, defId: 2 }], colors: [1, 2, 3, 0] })
  assert.deepEqual(t.sent, ['%xt%o%iu%1763249%0%1%12%', '%xt%o%iu%1763249%1%0%10%'])
  assert.equal(r.recolored, false)
})
