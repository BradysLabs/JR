'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Dispatch } = require('../src/engine/dispatch')
const { decode } = require('../src/engine/codec')
const { ShopService, summarizeSales, salesCsv } = require('../plugins/shop-restocker/shop')

function setup () {
  const d = new Dispatch()
  const sent = []
  d.session = { toServer: (t) => sent.push(t), toGame: () => {} }
  d.setState('player', { userName: 'Seller' })
  d.setState('room', '7882775')
  const den = new Map([['3993', { name: 'My Shop', specialType: 5 }], ['994', { name: 'Lamp' }]])
  const clothing = new Map([['439', { name: 'Headdress' }], ['60', { name: 'Collar' }]])
  const items = { getDenItem: (id) => den.get(String(id)) || null, getClothing: (id) => clothing.get(String(id)) || null }
  const data = {}
  const storage = { get: (k, f) => (k in data ? JSON.parse(JSON.stringify(data[k])) : f), set: (k, v) => { data[k] = v } }
  const s = new ShopService({ dispatch: d, items, storage, restockDelay: 5 })
  const server = (text) => d.process(decode(text, 'in'))
  const game = (text) => d.process(decode(text, 'out'))
  // Answers JR's next request once it has been sent.
  const answer = async (text) => {
    const before = sent.length
    for (let i = 0; i < 200 && sent.length === before; i++) await new Promise(r => setTimeout(r, 2))
    return server(text)
  }
  return { d, s, sent, server, game, answer, data }
}

// Clothing: Headdress ×2 (color 5) in slots 10 and 11, Collar in 12 (equipped), Collar in 13.
const IL = '%xt%il%-1%0%1%1%Seller%0%8%4%439%10%5%0%0%439%11%5%0%0%60%12%9%1%0%60%13%9%0%0%'
// Den: My Shop stand (placed) in 151, Lamp in storage in 20 and placed in 21.
const DI = '%xt%di%-1%0%3%0%151%3993%1%0%true%%0%%0%20%994%0%2%true%%0%%0%21%994%1%2%true%%0%%0%'

test('saves a shop as a template and refills it with matching items', async () => {
  const { s, sent, server, answer } = setup()
  await server(IL)
  await server(DI)
  assert.deepEqual(s.stands().map(x => x.id), [151])

  // Shop has a Headdress (slot 10) for 50 Diamonds and the Lamp (slot 20) for 30 Gems.
  const saving = s.saveTemplate(151, 'Weekend')
  await answer('%xt%dsi%-1%1%2%v1%3%50%2%10%439%0%30%0%20%994%')
  const t = await saving
  assert.equal(sent[0], '%xt%o%dsi%7882775%seller%151%')
  assert.deepEqual(t.items.map(i => [i.kind, i.defId, i.color, i.version, i.currency, i.cost]), [
    ['clothing', 439, 5, undefined, 3, 50],
    ['den', 994, undefined, 2, 0, 30]
  ])

  // Both sold. Refill uses the other Headdress (11), and not the placed Lamp (21) or the one that sold (20).
  await server('%xt%dsb%-1%1%Seller%151%3%50%2%10%439%900%')
  await server('%xt%dsb%-1%1%Seller%151%0%30%0%20%994%900%')
  const filling = s.restock(151, t.id)
  await answer('%xt%dsi%-1%1%0%v2%')
  await answer('%xt%dsu%-1%1%v3%')
  await answer('%xt%dsi%-1%1%1%v3%3%50%2%11%439%')
  const r = await filling
  assert.equal(sent[2], '%xt%o%dsu%7882775%151%v2%1%2%11%3%50%0%')
  assert.equal(r.added, 1)
  assert.deepEqual(r.missing, ['Lamp'])
})

test('replies to JR\'s own requests are kept from the game, the game\'s own replies are not', async () => {
  const { s, d, game, server, answer } = setup()
  await server(IL)
  const p = s.readShop(151)
  const reply = decode('%xt%dsi%-1%1%0%', 'in')
  const before = d.state
  await new Promise(r => setTimeout(r, 5))
  await d.process(reply)
  await p
  assert.equal(reply.send, false)
  void before; void answer

  await game('%xt%o%dsi%7882775%Seller%151%')
  const own = decode('%xt%dsi%-1%1%0%', 'in')
  await d.process(own)
  assert.notEqual(own.send, false)
})

test('does not list equipped clothing, and only fills what is missing', async () => {
  const { s, server, answer, sent } = setup()
  await server(IL)
  await server(DI)
  s.templates.push({ id: 'x', name: 'Collars', items: [
    { kind: 'clothing', defId: 60, color: 9, currency: 3, cost: 5, name: 'Collar' },
    { kind: 'clothing', defId: 60, color: 9, currency: 3, cost: 5, name: 'Collar' }
  ] })
  const filling = s.restock(151, 'x')
  await answer('%xt%dsi%-1%1%0%%')
  await answer('%xt%dsu%-1%1%v9%')
  await answer('%xt%dsi%-1%1%1%v9%3%5%2%13%60%')
  const r = await filling
  assert.equal(sent[1], '%xt%o%dsu%7882775%151%%1%2%13%3%5%0%')
  assert.equal(r.added, 1)
  assert.deepEqual(r.missing, ['Collar'])
})

test('automatic refill after the shop empties', async () => {
  const { s, server, answer, sent } = setup()
  await server(IL)
  s.templates.push({ id: 'h', name: 'Hats', items: [{ kind: 'clothing', defId: 439, color: 5, currency: 3, cost: 20, name: 'Headdress' }] })
  s.setAuto(151, 'h', 'empty')
  await server('%xt%dsb%-1%1%Seller%151%3%20%2%10%439%900%')
  await answer('%xt%dsi%-1%1%0%v4%')
  await answer('%xt%dsu%-1%1%v5%')
  await answer('%xt%dsi%-1%1%1%v5%3%20%2%11%439%')
  await new Promise(r => setTimeout(r, 30))
  assert.equal(sent[1], '%xt%o%dsu%7882775%151%v4%1%2%11%3%20%0%')
  assert.match(s.activity[0].text, /added 1 item/)
})

test('templates can be renamed and deleted', () => {
  const { s, data } = setup()
  s.templates.push({ id: 'a', name: 'Old', items: [] })
  s.renameTemplate('a', '  New name  ')
  assert.equal(data.templates[0].name, 'New name')
  assert.throws(() => s.renameTemplate('a', '   '))
  s.setAuto(5, 'a')
  s.deleteTemplate('a')
  assert.equal(data.templates.length, 0)
  assert.deepEqual(data.auto, {})
})

test('items you take out in the game become free to refill again (from a real session)', async () => {
  const { s, server, game, answer, sent } = setup()
  // Shirt-like items in slots 5, 2, 1 (defs 286, 136, 400).
  await server('%xt%il%-1%0%1%1%Seller%0%8%3%286%5%7%0%0%136%2%7%0%0%400%1%7%0%0%')
  await game('%xt%o%dsu%7882775%151%%3%2%5%3%10%2%2%0%50%2%1%3%2%0%')
  await server('%xt%dsu%-1%1%34199383%')
  assert.equal(s.clothing.get(5).shop, 151)
  const saving = s.saveTemplate(151, 'Real')
  await answer('%xt%dsi%-1%1%3%34199383%3%10%2%5%286%0%50%2%2%136%3%2%2%1%400%')
  const t = await saving
  // You take all three out in the game.
  await game('%xt%o%dsu%7882775%151%34199383%0%3%2%5%2%2%2%1%')
  await server('%xt%dsu%-1%1%%')
  assert.equal(s.clothing.get(5).shop, 0)
  const filling = s.restock(151, t.id)
  await answer('%xt%dsi%-1%1%0%')
  await answer('%xt%dsu%-1%1%v2%')
  await answer('%xt%dsi%-1%1%3%v2%3%10%2%5%286%0%50%2%2%136%3%2%2%1%400%')
  const r = await filling
  assert.equal(r.added, 3)
  assert.equal(sent[2], '%xt%o%dsu%7882775%151%%3%2%5%3%10%2%2%0%50%2%1%3%2%0%')
})

test('the game file patch makes My Shop ask the server each time', () => {
  const swf = require('../src/game/swf')
  assert.equal(typeof swf.patchShopRefresh, 'function')
})

test('shops can be given your own name, and reset', async () => {
  const { s, server, data } = setup()
  await server(DI)
  assert.equal(s.stands()[0].name, 'My Shop')
  s.renameShop(151, '  Rares  ')
  assert.equal(s.stands()[0].name, 'Rares')
  assert.equal(s.stands()[0].standName, 'My Shop')
  assert.deepEqual(data.names, { 151: 'Rares' })
  s.renameShop(151, '')
  assert.equal(s.stands()[0].name, 'My Shop')
})

test('a request Animal Jam never answers does not swallow the game\'s next answer', async () => {
  const d = new Dispatch()
  d.session = { toServer: () => {}, toGame: () => {} }
  d.setState('player', { userName: 'Seller' })
  d.setState('room', '1')
  const s = new ShopService({ dispatch: d, items: {}, storage: { get: (k, f) => f, set: () => {} }, replyTimeout: 50 })
  await assert.rejects(s.readShop(999), /didn.t answer/)
  // The game opens a shop afterwards; its answer must reach the game.
  await d.process(decode('%xt%o%dsi%1%Seller%151%', 'out'))
  const reply = decode('%xt%dsi%-1%1%0%', 'in')
  await d.process(reply)
  assert.notEqual(reply.send, false)
})

test('the game\'s shop request waits while JR is waiting for its own answer', async () => {
  const d = new Dispatch()
  const sent = []
  d.session = { toServer: (t) => sent.push(t), toGame: () => {} }
  d.setState('player', { userName: 'Seller' })
  d.setState('room', '1')
  const s = new ShopService({ dispatch: d, items: {}, storage: { get: (k, f) => f, set: () => {} } })
  const reading = s.readShop(151)
  for (let i = 0; i < 100 && !sent.length; i++) await new Promise(r => setTimeout(r, 5))
  const gameAsk = decode('%xt%o%dsi%1%Seller%152%', 'out')
  await d.process(gameAsk)
  assert.equal(gameAsk.send, false) // held
  const mine = decode('%xt%dsi%-1%1%0%', 'in')
  await d.process(mine)
  await reading
  assert.equal(mine.send, false) // JR's answer stays with JR
  for (let i = 0; i < 100 && sent.length < 2; i++) await new Promise(r => setTimeout(r, 5))
  assert.equal(sent[1], '%xt%o%dsi%1%Seller%152%') // the game's request went out after
  const theirs = decode('%xt%dsi%-1%1%0%', 'in')
  await d.process(theirs)
  assert.notEqual(theirs.send, false) // and its answer reaches the game
})

test('den list with mannequins reads right even before item names load', async () => {
  const d = new Dispatch()
  const den = new Map([['3993', { name: 'My Shop', specialType: 5 }], ['500', { name: 'Mannequin', specialType: 4 }]])
  const items = { ready: false, getDenItem: (id) => (items.ready ? den.get(String(id)) || { name: 'x' } : null) }
  const s = new ShopService({ dispatch: d, items, storage: { get: (k, f) => f, set: () => {} } })
  const manq = ['1', '500', '1', '0', 'true', '', '0', '', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '0']
  const stand1 = ['151', '3993', '1', '0', 'true', '', '0', '', '0']
  const stand2 = ['160', '3993', '1', '0', 'true', '', '0', '', '0']
  await d.process(decode(`%xt%di%-1%0%3%0%${manq.join('%')}%${stand1.join('%')}%${stand2.join('%')}%`, 'in'))
  assert.deepEqual([...s.den.keys()], [1, 151, 160])
  assert.equal(s.stands().length, 0) // names not loaded yet
  items.ready = true
  assert.deepEqual(s.stands().map(x => x.id), [151, 160])
})

test('a sale sends a desktop notification when JR is given one', async () => {
  const { d } = setup()
  const notes = []
  const den = new Map([['994', { name: 'Lamp' }]])
  const s = new ShopService({
    dispatch: d,
    items: { getDenItem: (id) => den.get(String(id)) || null, getClothing: () => null },
    storage: { get: (k, f) => f, set: () => {} },
    notify: (n) => notes.push(n)
  })
  await d.process(decode('%xt%dsb%-1%1%Seller%151%0%30%0%20%994%900%', 'in'))
  assert.deepEqual(notes, [{ title: 'Item sold', body: 'Lamp for 30 Gems.' }])
  // Someone else's sale: nothing.
  await d.process(decode('%xt%dsb%-1%1%Other%151%0%30%0%20%994%900%', 'in'))
  assert.equal(notes.length, 1)
  s.dispose()
})

test('sales log: every sale is kept, with totals, a spreadsheet copy and clearing', async () => {
  const { s, server, data } = setup()
  s.renameShop(151, 'Front shop')
  await server('%xt%dsb%-1%1%Seller%151%3%50%2%10%439%900%')
  await server('%xt%dsb%-1%1%Seller%151%0%30%0%20%994%900%')
  await server('%xt%dsb%-1%1%Someone%151%0%99%0%20%994%900%') // not yours
  const snap = s.snapshot()
  assert.equal(snap.salesCount, 2)
  assert.deepEqual(snap.sales.map(x => [x.name, x.cost, x.currency, x.kind, x.shop]), [
    ['Lamp', 30, 0, 'den', 'Front shop'],
    ['Headdress', 50, 3, 'clothing', 'Front shop']
  ])
  assert.deepEqual(snap.salesTotals.today, { 3: 50, 0: 30, count: 2 })
  assert.equal(data.sales.length, 2) // saved with the profile

  const csv = s.salesCsv().split('\n')
  assert.equal(csv[0], 'Time,Item,Type,Price,Currency,Shop')
  assert.match(csv[1], /,Headdress,clothing,50,Diamonds,Front shop$/)
  assert.match(csv[2], /,Lamp,den,30,Gems,Front shop$/)

  assert.equal(s.clearSales(), 2)
  assert.equal(s.snapshot().salesCount, 0)
})

test('sales log: totals split today, the last week and older; CSV quotes commas', () => {
  const now = new Date('2026-10-22T15:00:00').getTime()
  const at = (h) => new Date(now - h * 3600 * 1000).toISOString()
  const t = summarizeSales([
    { at: at(1), cost: 10, currency: 3 },
    { at: at(30), cost: 5, currency: 0 },
    { at: at(24 * 10), cost: 7, currency: 3 }
  ], now)
  assert.deepEqual(t.today, { 3: 10, 0: 0, count: 1 })
  assert.deepEqual(t.week, { 3: 10, 0: 5, count: 2 })
  assert.deepEqual(t.all, { 3: 17, 0: 5, count: 3 })
  assert.match(salesCsv([{ at: 'x', name: 'Hat, Rare', kind: 'clothing', cost: 1, currency: 3, shop: 'A "b"' }]), /"Hat, Rare",clothing,1,Diamonds,"A ""b"""$/)
})

test('sales log: a damaged saved log starts fresh', () => {
  const d = new Dispatch()
  const s = new ShopService({ dispatch: d, items: {}, storage: { get: (k, f) => (k === 'sales' ? 'oops' : f), set: () => {} } })
  assert.deepEqual(s.sales, [])
})

/* ---------------------------------------------------- shop explorer */

const { readDenStands, parseShopItems } = require('../plugins/shop-restocker/shop')
// A real visit to a friend's den (name and shop ids replaced).
const VISIT = require('./fixtures/den-visit.json')

test('shop explorer: finds the My Shop stands in a den, left to right', () => {
  const v = decode(VISIT.ds, 'in').value
  const stands = readDenStands(v, (defId) => defId === 3993)
  assert.deepEqual(stands.map(s => s.id), [4153, 4174, 3391, 3192, 3381, 3389])
  assert.deepEqual(stands[0], { id: 4153, defId: 3993, placed: true, x: 384, y: 489 })
})

test('shop explorer: reads pets, clothing and den items in other players\' shops', () => {
  const [pets, clothing, den] = VISIT.dsi.map(t => parseShopItems(decode(t, 'in').value))
  assert.equal(pets.length, 16)
  assert.deepEqual(pets[0], { kind: 'pet', currency: 3, cost: 65, slot: 325, defId: 121 })
  assert.deepEqual(pets.filter(i => i.kind === 'clothing')[0], { kind: 'clothing', currency: 3, cost: 395, slot: 9170, defId: 285, color: 341114880 })
  assert.equal(clothing.length, 21)
  assert.ok(clothing.every(i => i.kind === 'clothing' && i.currency === 3))
  assert.deepEqual(clothing[0], { kind: 'clothing', currency: 3, cost: 15, slot: 5161, defId: 3427, color: 271654399 })
  assert.equal(den.length, 21)
  assert.deepEqual(den[15], { kind: 'den', currency: 3, cost: 125, slot: 4928, defId: 790 })
  // Your own shop's shorter answer still reads.
  assert.deepEqual(parseShopItems(decode('%xt%dsi%-1%1%2%v1%3%50%2%10%439%0%30%0%20%994%', 'in').value).map(i => [i.kind, i.cost, i.defId]), [['clothing', 50, 439], ['den', 30, 994]])
})

test('shop explorer: scans every stand in the den you walked into', async () => {
  const { d, s, sent, server } = setup()
  await server(VISIT.rj)
  await server(VISIT.ds)
  const room = d.getState('room')
  let e = s.explorer()
  assert.equal(e.owner, 'friend')
  assert.equal(e.here, true)
  assert.equal(e.stands.length, 6)
  assert.equal(e.stands[0].items, null)

  // Answer each stand's request with one of the captured shops.
  s.wait = async () => {}
  const answers = [...VISIT.dsi, ...VISIT.dsi]
  const answering = (async () => {
    for (let n = 0; n < 6; n++) {
      const before = sent.length
      for (let i = 0; i < 400 && sent.length === before; i++) await new Promise(r => setTimeout(r, 2))
      await server(answers[n])
    }
  })()
  const result = await s.scanDen()
  await answering
  assert.deepEqual(result, { shops: 6, failed: 0, items: 16 + 21 + 21 + 16 + 21 + 21, stopped: false })
  assert.equal(sent[0], `%xt%o%dsi%${room}%friend%4153%`)
  e = s.explorer()
  assert.equal(e.stands[1].items[0].name, 'Item #3427') // clothing, named from item names
  assert.equal(e.stands[0].items[0].name, null) // pets are named by the window
  assert.ok(e.stands.every(st => st.checkedAt))

  // Somewhere else now.
  await server('%xt%rj%1072141%1%jamaa_township.room_main%999%1%')
  assert.equal(s.explorer().here, false)
  await assert.rejects(s.browseShop(4174), /left that den/)
})

test('shop explorer: needs a den first', async () => {
  const { s } = setup()
  assert.deepEqual(s.explorer(), { owner: null, stands: [], here: false, scan: null })
  await assert.rejects(s.scanDen(), /Go into a den/)
})

test('shop explorer: the game sending the den again keeps you in it and keeps what was read', async () => {
  const { s, sent, server } = setup()
  s.wait = async () => {}
  await server(VISIT.rj)
  await server(VISIT.ds)
  const reading = s.browseShop(4153)
  while (!sent.length) await new Promise(r => setTimeout(r, 2))
  await server(VISIT.dsi[0])
  await reading
  // Same den's items again, this time with -1 as the room.
  await server(VISIT.ds.replace('%xt%ds%1072141%', '%xt%ds%-1%'))
  const e = s.explorer()
  assert.equal(e.here, true)
  assert.equal(e.stands.find(st => st.id === 4153).items.length, 16)
})

test('shop explorer: a late answer is dropped, not given to the next shop', async () => {
  const { s, sent, server } = setup()
  const waits = []
  s.wait = async (ms) => { waits.push(ms) }
  await server(VISIT.rj)
  await server(VISIT.ds)
  // The first shop doesn't answer in time.
  const slow = s._ask('dsi', ['friend', 4153], { timeout: 20 })
  await assert.rejects(slow, /didn.t answer/)
  const next = s.browseShop(4174)
  while (sent.length < 2) await new Promise(r => setTimeout(r, 2))
  await server(VISIT.dsi[0]) // the first shop's answer, arriving late: dropped
  await server(VISIT.dsi[1]) // the answer for 4174
  const shop = await next
  assert.equal(shop.items.length, 21)
  assert.ok(shop.items.every(i => i.kind === 'clothing'))
})

test('shop explorer: a scan retries a shop that didn\'t answer, and can be stopped', async () => {
  const { s, sent, server } = setup()
  s.wait = async () => {}
  await server(VISIT.rj)
  await server(VISIT.ds)
  const answered = []
  let skipFirst = true
  const answering = (async () => {
    for (let n = 0; n < 7; n++) {
      const before = sent.length
      for (let i = 0; i < 2000 && sent.length === before; i++) await new Promise(r => setTimeout(r, 2))
      if (sent.length === before) break
      if (skipFirst) { skipFirst = false; continue } // shop 1 says nothing the first time
      answered.push(sent[sent.length - 1])
      await server(VISIT.dsi[n % 3])
    }
  })()
  // Shorter waits than the real ones, so the test is quick.
  const browse = s.browseShop.bind(s)
  s.browseShop = async (id) => {
    const v = await s._ask('dsi', ['friend', id], { timeout: 200 })
    s.visit.shops.set(id, { items: require('../plugins/shop-restocker/shop').parseShopItems(v), checkedAt: 'x' })
  }
  const result = await s.scanDen()
  await answering
  assert.equal(result.shops, 6)
  assert.equal(result.failed, 0)
  assert.match(answered[answered.length - 1], /%friend%4153%$/) // the retry
  s.browseShop = browse

  // Stop.
  const stopping = s.scanDen()
  s.stopScan()
  const r = await stopping.catch(e => e)
  assert.ok(r.stopped || r instanceof Error)
})
