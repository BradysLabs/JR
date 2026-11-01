'use strict'

// Fixes for bugs members reported on the JR Discord (Oct 2026).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.join(__dirname, '..')
const { createPricer } = require('../src/worth/pricer')
const { createWorthLookup } = require('../src/worth/bubble')
const match = require('../src/worth/match')
const { move } = require('../src/game/mod/build')

const worthItems = JSON.parse(fs.readFileSync(path.join(root, 'data', 'worth', 'values.json'), 'utf8')).items

// A pair of Rare Nerd Glasses: black frame, then a white or a yellow tape.
const PALETTE = [0x222222, 0xF7CD66, 0xFFFFFF, 0x7B5C46]
const pack = (a, b, c, d) => ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
const WHITE_TAPE = pack(0, 2, 2, 3)
const YELLOW_TAPE = pack(0, 1, 2, 3)
function fakeItems () {
  return {
    clothing: new Map([['1', { name: 'Rare Nerd Glasses', colors: [WHITE_TAPE, YELLOW_TAPE] }]]),
    den: new Map([['2', { name: 'Books' }]]),
    getClothing (id) { return this.clothing.get(String(id)) || null },
    getDenItem (id) { return this.den.get(String(id)) || null },
    layerColors (c) { c = c >>> 0; return [c >>> 24 & 255, c >>> 16 & 255, c >>> 8 & 255, c & 255].map(i => PALETTE[i]) }
  }
}

test('worth: Rare Nerd Glasses are valued by their tape color, not one value for both', () => {
  const items = fakeItems()
  const pricer = createPricer({ root, items, worthItems })
  const lookup = createWorthLookup({ worthItems, db: items })
  const yellow = pricer.value({ kind: 'clothing', id: 1, color: YELLOW_TAPE })
  assert.deepEqual(yellow.rows.map(r => r.id), ['nerd-glasses/adventure-nerd-glasses'])
  assert.deepEqual(yellow.diamonds, { min: 2, max: 5 })
  const white = pricer.value({ kind: 'clothing', id: 1, color: WHITE_TAPE })
  assert.deepEqual(white.rows.map(r => r.id), ['nerd-glasses/rare-item-monday'])
  const hover = lookup({ defId: 1, color: YELLOW_TAPE, kind: 'clothing' })
  assert.equal(hover.matched, true)
  assert.deepEqual(hover.diamonds, { min: 2, max: 5 })
})

test('worth: one-word items like the Books den beta are found, version words are not', () => {
  const index = match.indexWorth(worthItems)
  const exact = (name) => match.rowsFor(index, name, null).filter(r => !r._wikiNameCandidate).map(r => r.id)
  assert.deepEqual(exact('Books'), ['den-betas/books'])
  assert.deepEqual(exact('Rare'), [])
  assert.deepEqual(exact('Panda'), [])
  const lookup = createWorthLookup({ worthItems, db: fakeItems() })
  const books = lookup({ defId: 2, kind: 'den' })
  assert.equal(books.matched, true)
  assert.deepEqual(books.diamonds, { min: 15, max: 20 })
})

test('in-game features build: a file Windows briefly locks is moved once it lets go', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-move-'))
  const from = path.join(dir, 'out.swf')
  const to = path.join(dir, 'game.swf')
  fs.writeFileSync(from, 'swf')
  const real = fs.renameSync
  let calls = 0
  fs.renameSync = (...args) => {
    if (++calls <= 2) { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e }
    return real(...args)
  }
  try {
    await move(from, to, { delay: 1 })
  } finally { fs.renameSync = real }
  assert.equal(calls, 3)
  assert.equal(fs.readFileSync(to, 'utf8'), 'swf')
  assert.equal(fs.existsSync(from), false)
  // Still locked after every try: copied over instead.
  fs.writeFileSync(from, 'again')
  fs.renameSync = () => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e }
  try { await move(from, to, { tries: 2, delay: 1 }) } finally { fs.renameSync = real }
  assert.equal(fs.readFileSync(to, 'utf8'), 'again')
  fs.rmSync(dir, { recursive: true, force: true })
})

/* --------------------------------------------- Den Item Previewer */

const { Dispatch } = require('../src/engine/dispatch')
const { decode } = require('../src/engine/codec')
const { DenPreviews, withPreviews, withInventoryPreviews, splitPreviewChanges } = require('../plugins/den-item-previewer/den')
const { joinPacket } = require('../plugins/recent-rooms/rooms')
const DEN_VISIT = require('./fixtures/den-visit.json')

function denSetup ({ inGame = true } = {}) {
  const d = new Dispatch()
  const sent = []
  const toGame = []
  const asked = []
  d.session = { toServer: (t) => sent.push(t), toGame: (t) => toGame.push(t) }
  d.setState('room', '1072141')
  d.setState('roomName', 'denFriend')
  const dens = new Map([['994', { name: 'Books' }], ['50', { name: 'Wolf Mannequin', specialType: 4 }]])
  const game = { send: (kind, value) => asked.push([kind, value]), ready: () => inGame }
  const p = new DenPreviews({ dispatch: d, getDenItem: (id) => dens.get(String(id)) || null, myName: () => 'friend', joinPacket, game })
  return { d, p, sent, toGame, asked }
}

test('den previewer: den and den-item records for previews', () => {
  const v = DEN_VISIT.ds.split('%')
  const p = { slot: 1900000000, defId: 994, version: 2, x: 700.4, y: 500 }
  const out = withPreviews(v, [p])
  assert.equal(out[4], 39) // one more item
  assert.equal(out[5], v[5]) // pet count untouched
  assert.equal(out[6], v[6]) // not a forced reload
  assert.deepEqual(out.slice(7, 19), [1900000000, 994, 1, 700, 500, 2, 0, 'null', '', 0, '', 0])
  assert.deepEqual(out.slice(19), v.slice(7)) // the real items and pets follow unchanged
  assert.equal(withPreviews(['', 'xt', 'il', '1'], [p]), null)
  // A mannequin: its look and its five clothing slots (10 fields), all default.
  const m = withPreviews(v, [{ ...p, mannequin: true }])
  assert.deepEqual(m.slice(7, 29), [1900000000, 994, 1, 700, 500, 2, 0, 'null', '', 0, '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(m.slice(29), v.slice(7))
  // Den items: %xt%di%<room>%<den>%<count>%<pets in den>%  then the items.
  const di = ['', 'xt', 'di', '-1', '0', '1', '0', '3519', '4316', '1', '0', 'true', '', '-1', '', '0', '']
  const inv = withInventoryPreviews(di, [{ ...p, placed: true }])
  assert.equal(inv[5], 2)
  assert.deepEqual(inv.slice(7, 16), [1900000000, 994, 1, 2, 'true', '', -1, '', 0])
  assert.deepEqual(inv.slice(16), di.slice(7))
})

test('den previewer: saving den changes notes where previews went and drops them', () => {
  // Real saves from the game (packets.log): 17 fields per item, sometimes one
  // more field right after the count.
  const real = [
    '%xt%o%ds%4979268%1%0%0%1900000001%1%355%891%0%off%0%0%0%0%0%0%0%0%0%0%',
    '%xt%o%ds%4979268%1%0%1900000001%0%0%0%0%off%0%0%0%0%0%0%0%0%0%0%',
    '%xt%o%ds%4979268%2%0%0%1900000001%1%590%538%0%off%0%0%0%0%0%0%0%0%0%0%0%1900000002%1%1583%615%0%off%0%0%0%0%0%0%0%0%0%0%'
  ].map(t => t.split('%'))
  const slots = new Set(['1900000001', '1900000002'])
  assert.deepEqual(splitPreviewChanges(real[0], slots).changes, [{ slot: 1900000001, placed: true, x: 355, y: 891, flipped: false }])
  assert.equal(splitPreviewChanges(real[0], slots).value[5], 0)
  assert.deepEqual(splitPreviewChanges(real[1], slots).changes, [{ slot: 1900000001, placed: false, x: 0, y: 0, flipped: false }])
  assert.deepEqual(splitPreviewChanges(real[2], slots).changes.map(c => [c.slot, c.x, c.y]), [[1900000001, 590, 538], [1900000002, 1583, 615]])
  // A real item next to a preview: only the preview comes out, extra fields stay.
  const entry = (slot, placed, x, y) => [0, slot, placed, x, y, 0, 'off', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  const save = ['', 'xt', 'o', 'ds', '1072141', 2, 0, ...entry(3519, 1, 10, 20), ...entry(1900000000, 1, 640, 420), '']
  const split = splitPreviewChanges(save, new Set(['1900000000']))
  assert.deepEqual(split.value, ['', 'xt', 'o', 'ds', '1072141', 1, 0, ...entry(3519, 1, 10, 20), ''])
  assert.deepEqual(split.changes, [{ slot: 1900000000, placed: true, x: 640, y: 420, flipped: false }])
  assert.equal(splitPreviewChanges(save, new Set(['5'])), null)
})

test('den previewer: the game places previews itself, so nothing else in your den moves', async () => {
  const { d, p, sent, toGame, asked } = denSetup()
  const { preview, shown } = await p.place(994, { version: 1 })
  assert.equal(shown, 'den')
  // One "add" for the game: in your den items and in your den. No den reload.
  assert.deepEqual(asked, [['dp', { op: 'add', s: preview.slot, d: 994, v: 1, place: true }]])
  assert.equal(toGame.length, 0)
  assert.equal(sent.length, 0)
  const m = await p.place(50)
  assert.equal(m.preview.mannequin, true) // mannequins can be previewed too
  await assert.rejects(() => p.place(12345), /isn.t a den item/)
  await p.remove(m.preview.slot)
  assert.deepEqual(asked.pop(), ['dp', { op: 'remove', s: m.preview.slot }])
  // Not in your den: it goes in your den items for now.
  d.setState('roomName', 'jamaa_township.room_main#7')
  const later = await p.place(994)
  assert.equal(later.shown, 'bar')
  assert.equal(asked.pop()[1].place, false)
  await p.remove(later.preview.slot)
  d.setState('roomName', 'denFriend')

  // You drag the preview and finish editing: the game saves. JR notes where
  // it went, the server only hears about your real item, and the game's
  // answer says the preview was saved too.
  const save = decode(`%xt%o%ds%1072141%2%0%0%3519%1%10%20%0%off%0%0%0%0%0%0%0%0%0%0%0%${preview.slot}%1%640%420%1%off%0%0%0%0%0%0%0%0%0%0%`, 'out')
  await d.process(save)
  assert.notEqual(save.send, false)
  assert.equal(String(save.value[5]), '1')
  assert.ok(!save.value.map(String).includes(String(preview.slot)))
  assert.deepEqual([preview.x, preview.y, preview.flipped, preview.placed], [640, 420, true, true])
  const saved = decode('%xt%dss%-1%3519%', 'in')
  await d.process(saved)
  assert.deepEqual(saved.value.slice(4).map(String), ['3519', String(preview.slot), ''])

  // Only the preview moved: the server hears nothing, the game gets its answer from JR.
  const onlyPreview = decode(`%xt%o%ds%1072141%1%0%0%${preview.slot}%1%700%450%0%off%0%0%0%0%0%0%0%0%0%0%`, 'out')
  await d.process(onlyPreview)
  assert.equal(onlyPreview.send, false)
  assert.equal(toGame.pop(), `%xt%dss%-1%${preview.slot}%`)
  assert.deepEqual([preview.x, preview.y], [700, 450])

  // Coming back to your den later: the preview is where you left it, and in your den items.
  const ownDen = decode(DEN_VISIT.ds, 'in')
  await d.process(ownDen)
  assert.equal(String(ownDen.value[4]), '39')
  assert.deepEqual(ownDen.value.slice(7, 12).map(String), [String(preview.slot), '994', '1', '700', '450'])
  const items = decode('%xt%di%-1%0%1%0%3519%4316%1%0%true%%-1%%0%', 'in')
  await d.process(items)
  assert.equal(String(items.value[5]), '2')
  assert.equal(String(items.value[7]), String(preview.slot))

  // Put back in your den items: saved as not placed, so it stays out of the den.
  const pickUp = decode(`%xt%o%ds%1072141%1%0%${preview.slot}%0%0%0%0%off%0%0%0%0%0%0%0%0%0%0%`, 'out')
  await d.process(pickUp)
  assert.equal(preview.placed, false)
  const again = decode(DEN_VISIT.ds, 'in')
  await d.process(again)
  assert.equal(String(again.value[4]), '38')

  // A save JR can't read that names a preview never reaches the server either.
  const odd = decode(`%xt%o%ds%1072141%3%${preview.slot}%`, 'out')
  await d.process(odd)
  assert.equal(odd.send, false)
  assert.equal(toGame.pop(), `%xt%dss%-1%${preview.slot}%`)
  // Anything else naming it never reaches the server.
  const other = decode(`%xt%o%dr%1072141%0%${preview.slot}%`, 'out')
  await d.process(other)
  assert.equal(other.send, false)
  // Someone else's den is left alone.
  d.setState('roomName', 'denSomeoneElse')
  const theirs = decode(DEN_VISIT.ds, 'in')
  await d.process(theirs)
  assert.equal(String(theirs.value[4]), '38')
  await p.clear()
  p.dispose()
})

test('den previewer: without JR\'s in-game build, going back into your den shows it', async () => {
  const { p, sent, asked } = denSetup({ inGame: false })
  const { shown } = await p.place(994)
  assert.equal(shown, 'den')
  assert.equal(asked.length, 0)
  assert.equal(sent.pop(), '%xt%o%dj%1072141%denfriend%1%-1%')
  p.dispose()
})

/* ------------------------------------------------------- item pictures */

const { ItemPictures, pictureKey } = require('../src/game/pictures')

test('item pictures: asked for once, kept on disk, versions remembered', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-pics-'))
  const asks = []
  const pics = new ItemPictures({ dir, send: (kind, value) => asks.push([kind, value]) })
  assert.equal(pictureKey({ kind: 'clothing', id: 637, color: -1 }), 'c637_4294967295')
  assert.equal(pictureKey({ kind: 'den', id: 24, version: 2 }), 'd24_2')
  pics.request([{ kind: 'den', id: 24 }, { kind: 'clothing', id: 637, color: 5 }, { kind: 'den', id: 24 }])
  assert.equal(asks.length, 1)
  assert.deepEqual(asks[0][1].q.map(q => q.key), ['d24_0', 'c637_5'])
  pics.request([{ kind: 'den', id: 24 }]) // already asked: not again
  assert.equal(asks.length, 1)
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), Buffer.alloc(20)])
  const got = []
  pics.on('picture', (key, url) => got.push([key, url]))
  pics.receive('d24_0', png.toString('base64'), '3')
  assert.equal(got[0][0], 'd24_0')
  assert.match(got[0][1], /^file:.*d24_0\.png$/)
  assert.ok(pics.url({ kind: 'den', id: 24 }))
  assert.equal(pics.versionCount(24), 3)
  assert.equal(new ItemPictures({ dir, send: () => {} }).versionCount(24), 3)
  pics.receive('../evil', png.toString('base64'), '')
  assert.equal(fs.existsSync(path.join(dir, '..', 'evil.png')), false)
  fs.rmSync(dir, { recursive: true, force: true })
})

/* ------------------------------------------- in-game den item bar buttons */

test('den item bar: round Worth and Preview buttons fit where the old Worth button was', () => {
  const surfaces = ['wardrobe', 'shop', 'buying', 'social', 'play', 'tools'].flatMap(n => require(`../src/game/surfaces/${n}`))
  const { createSurfaces } = require('../src/game/surfaces')
  const s = createSurfaces({ bridge: { send () {} }, enabled: () => true, surfaces, ctx: { dispatch: new Dispatch(), items: { clothing: new Map(), den: new Map() }, log () {} } })
  const bar = s.anchors().denedit
  assert.deepEqual(bar.b.map(b => [b.l, b.i]), [['Worth', 'worth'], ['Preview', 'den']])
  assert.equal(bar.round, 28)
  // Two 28px round buttons with JRBar's 6px gap: 62px, the old Worth pill's width
  // (game-layout.json: jrBar_denedit 62 wide, left of the close button at x 372;
  // the house button ends at x 268).
  const width = bar.b.length * bar.round + (bar.b.length - 1) * 6
  assert.ok(width <= 62)
  assert.ok(372 - 6 - width > 268)
})

/* ---------------------------------------------------- previewer search */

test('previewer search: plurals, any word order, and item IDs', () => {
  const { itemMatcher } = require('../src/game/search')
  const names = ['Wolf Mannequin', 'Panda Mannequin', 'Wolf Hat', 'Rare Nerd Glasses', 'Books', 'Cherry Tree', 'Bench']
  const find = (q) => names.filter((n, i) => itemMatcher(q)(n, i + 1))
  assert.deepEqual(find('mannequins'), ['Wolf Mannequin', 'Panda Mannequin'])
  assert.deepEqual(find('wolf mannequins'), ['Wolf Mannequin'])
  assert.deepEqual(find('glasses nerd'), ['Rare Nerd Glasses'])
  assert.deepEqual(find('cherries'), ['Cherry Tree'])
  assert.deepEqual(find('benches'), ['Bench'])
  assert.deepEqual(find('5'), ['Books'])
  assert.deepEqual(find('zebra'), [])
})

/* ------------------------------------------------- keeping previews */

const { keepStore } = require('../src/game/keep')
const { ClothingPreviews } = require('../plugins/item-previewer/tryon')

test('kept previews: clothing you tried on is back (and back on) when you log in', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-keep-'))
  const keep = keepStore(path.join(dir, 'kept.json'))
  const d = new Dispatch()
  const toGame = []
  d.session = { toServer: () => {}, toGame: (t) => toGame.push(t) }
  const later = (fn) => fn()
  let name = 'tattedtheog'
  const cp = new ClothingPreviews({ dispatch: d, myName: () => name, keep, later })
  // Your inventory at login (real capture, shortened): JR learns your animal.
  await d.process(decode('%xt%il%-1%0%1%1%tattedtheog%11%4%87%285%11%1733623808%0%0%', 'in'))
  assert.equal(cp.ready, true)
  const shirt = cp.add({ id: 1653, name: 'Rare Plaid Shirt', colorIndex: 2, colorValue: 437737043 })
  const hat = cp.add({ id: 393, name: 'Rare Spiked Hair', colorIndex: 0, colorValue: 5 })
  cp.setWorn(hat.slot, false)
  assert.deepEqual(keep.load('tattedtheog').map(k => [k.id, k.worn]), [[1653, true], [393, false]])

  // Log out and back in.
  toGame.length = 0
  await d.process(decode('{"b":{"r":-1,"o":{"_cmd":"login","params":{"userName":"tattedtheog"}}}}', 'in'))
  assert.equal(cp.list().length, 0)
  await d.process(decode('%xt%il%-1%0%1%1%tattedtheog%11%4%87%', 'in'))
  // Both back in your items, the shirt back on.
  assert.deepEqual(cp.list().map(p => [p.id, p.colorIndex, p.worn]), [[1653, 2, true], [393, 0, false]])
  assert.ok(toGame.some(t => t.startsWith('%xt%il%-1%2%1%1%tattedtheog%437737043%1%0%') && t.endsWith('%1653%')))
  assert.ok(toGame.some(t => t.startsWith('%xt%il%-1%3%0%1%tattedtheog%0%1%0%') && t.includes('%1653%')))
  // Remove stops keeping one.
  cp.remove(cp.list()[1].slot)
  assert.deepEqual(keep.load('tattedtheog').map(k => k.id), [1653])
  // Another account has its own.
  name = 'myalt'
  await d.process(decode('{"b":{"r":-1,"o":{"_cmd":"login","params":{"userName":"myalt"}}}}', 'in'))
  await d.process(decode('%xt%il%-1%0%1%3%myalt%11%4%87%', 'in'))
  assert.equal(cp.list().length, 0)
  assert.deepEqual(keep.load('tattedtheog').map(k => k.id), [1653])
  cp.dispose()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('kept previews: den items are back where you left them when you log in', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-keep-'))
  const keep = keepStore(path.join(dir, 'kept.json'))
  const d = new Dispatch()
  const toGame = []
  d.session = { toServer: () => {}, toGame: (t) => toGame.push(t) }
  d.setState('room', '1072141')
  d.setState('roomName', 'denFriend')
  const dens = new Map([['994', { name: 'Books' }]])
  const opts = { dispatch: d, getDenItem: (id) => dens.get(String(id)) || null, myName: () => 'friend', joinPacket, game: { send () {}, ready: () => true }, keep }
  const p = new DenPreviews(opts)
  const { preview } = await p.place(994, { version: 1 })
  // You drag it and finish editing.
  await d.process(decode(`%xt%o%ds%1072141%1%0%0%${preview.slot}%1%640%420%1%off%0%0%0%0%0%0%0%0%0%0%`, 'out'))
  assert.deepEqual(keep.load('friend'), [{ defId: 994, name: 'Books', version: 1, mannequin: false, placed: true, x: 640, y: 420, flipped: true }])
  p.dispose()
  // Next login (a new JR): the den and den items have it, where you left it.
  const again = new DenPreviews(opts)
  await d.process(decode('{"b":{"r":-1,"o":{"_cmd":"login","params":{"userName":"friend"}}}}', 'in'))
  const den = decode(DEN_VISIT.ds, 'in')
  await d.process(den)
  assert.equal(String(den.value[4]), '39')
  assert.deepEqual(den.value.slice(8, 13).map(String), ['994', '1', '640', '420', '1'])
  const items = decode('%xt%di%-1%0%0%0%', 'in')
  await d.process(items)
  assert.equal(String(items.value[5]), '1')
  assert.equal(String(items.value[8]), '994')
  again.dispose()
  fs.rmSync(dir, { recursive: true, force: true })
})
