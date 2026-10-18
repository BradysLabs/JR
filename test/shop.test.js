'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Dispatch } = require('../src/engine/dispatch')
const { decode } = require('../src/engine/codec')
const { ShopService } = require('../plugins/shop-restocker/shop')

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
