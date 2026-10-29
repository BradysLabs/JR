'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const zlib = require('zlib')
const { rewriteStrings, openPack, u29Bytes } = require('../src/game/packs')
const { decodePack } = require('../src/game/items')
const { readAmf3 } = require('../src/game/amf3')
const { createLabeler, itemNames, shortValue } = require('../src/worth/labels')
const { GameServer } = require('../src/game/server')

/* A small AMF3 writer, only for building test packs. Repeated strings are
   written as references, as Flash does, so the tests cover those too. */
function amf3 (value) {
  const out = []
  const strings = []
  const str = (s) => {
    if (s === '') { out.push(0x01); return }
    const at = strings.indexOf(s)
    if (at !== -1) { out.push(...u29Bytes(at << 1)); return }
    strings.push(s)
    const bytes = Buffer.from(s, 'utf8')
    out.push(...u29Bytes((bytes.length << 1) | 1), ...bytes)
  }
  const write = (v) => {
    if (typeof v === 'string') { out.push(0x06); str(v); return }
    if (Number.isInteger(v)) { out.push(0x04, ...u29Bytes(v & 0x1FFFFFFF)); return }
    if (Array.isArray(v)) { out.push(0x09, ...u29Bytes((v.length << 1) | 1), 0x01); v.forEach(write); return }
    // Anonymous dynamic object: no sealed members.
    out.push(0x0A, 0x0B); str('')
    for (const [k, x] of Object.entries(v)) { str(k); write(x) }
    str('')
  }
  write(value)
  return Buffer.from(out)
}

const PACK = {
  100: 'Worn Blanket',
  101: 'Worn Blanket', // the same text again: an AMF3 string reference
  102: 'Play',
  list: [1, 'Elf Tail', 300]
}

const editor = (map) => (text) => map[text]

test('pack rewriter: changes chosen strings in all three wrappings, leaves the rest', () => {
  const raw = amf3(PACK)
  const wrappings = {
    raw: zlib.deflateRawSync(raw),
    zlib: zlib.deflateSync(raw),
    wrapped: (() => { const z = zlib.deflateRawSync(raw); return Buffer.concat([Buffer.from([0x0C, ...u29Bytes((z.length << 1) | 1)]), z]) })()
  }
  for (const [kind, buf] of Object.entries(wrappings)) {
    const { buf: out, changed } = rewriteStrings(buf, editor({ 'Worn Blanket': 'Worn Blanket · A Few RIMs' }))
    assert.equal(changed, 1, kind) // written once, referenced twice
    const decoded = decodePack(out)
    assert.equal(decoded[100], 'Worn Blanket · A Few RIMs', kind)
    assert.equal(decoded[101], 'Worn Blanket · A Few RIMs', kind)
    assert.equal(decoded[102], 'Play', kind)
    assert.deepEqual(decoded.list, [1, 'Elf Tail', 300], kind)
    assert.equal(openPack(out).wrap === null, kind !== 'wrapped', kind)
  }
})

test('pack rewriter: multi-byte lengths and unicode survive', () => {
  const long = 'x'.repeat(200) // length header needs two bytes
  const buf = zlib.deflateRawSync(amf3({ 1: long, 2: 'Café' }))
  const { buf: out } = rewriteStrings(buf, editor({ [long]: long + '!', 'Café': 'Café · 5 Diamonds' }))
  const decoded = decodePack(out)
  assert.equal(decoded[1], long + '!')
  assert.equal(decoded[2], 'Café · 5 Diamonds')
})

test('pack rewriter: nothing to change, empty replacements and unknown data return the original', () => {
  const buf = zlib.deflateRawSync(amf3(PACK))
  assert.equal(rewriteStrings(buf, () => null).buf, buf)
  assert.equal(rewriteStrings(buf, editor({ Play: '' })).buf, buf)
  const json = Buffer.from('{"a":1}')
  assert.equal(rewriteStrings(json, () => 'x').buf, json)
  const junk = Buffer.from([1, 2, 3, 4, 5])
  assert.equal(rewriteStrings(junk, () => 'x').buf, junk)
})

test('AMF3 reader still reads packs the same with string tracking added', () => {
  assert.deepEqual(readAmf3(amf3(PACK)), { 100: 'Worn Blanket', 101: 'Worn Blanket', 102: 'Play', list: [1, 'Elf Tail', 300] })
})

const offer = (text) => [{ text, min: 1, max: 1, unit: 'RIMs', knownUnit: true }]
const WORTH = [
  { id: 'a', page: 'Worn Blanket', name: 'Worn Blanket', variant: null, grade: null, offers: offer('A Few RIMs') },
  // Worth depends on color: no single value.
  { id: 'b', page: 'Elf Tail', name: 'Elf Tail', variant: 'Black', grade: null, offers: offer('2 Good Short Collars') },
  { id: 'c', page: 'Elf Tail', name: 'Elf Tail', variant: 'White', grade: null, offers: offer('5 Good Short Collars') },
  // Too long to fit.
  { id: 'd', page: 'Long Thing', name: 'Long Thing', variant: null, grade: null, offers: offer('1 Bad Long Collar + 1 Black Long Wrist') },
  // Two alternatives: the first is used.
  { id: 'e', page: 'Fox Hat', name: 'Fox Hat', variant: null, grade: null, offers: [...offer('2 RIMs'), ...offer('140-170 Diamonds')] }
]

test('worth labels: clear values as written, everything else as a Diamond range or "varies by color"', () => {
  const { label } = createLabeler([...WORTH,
    { id: 'f', page: 'Rare Spike', name: 'Rare Spike', variant: 'Black', grade: null, raw: '100 Diamonds', offers: offer('100 Diamonds') },
    { id: 'g', page: 'Rare Spike', name: 'Rare Spike', variant: 'White', grade: null, raw: '2400 Diamonds', offers: offer('2400 Diamonds') },
    { id: 'h', page: 'Big Thing', name: 'Big Thing', variant: null, grade: null, raw: '12000 Diamonds + 30000 Diamonds', offers: offer('12000 Diamonds + 30000 Diamonds plus more words') }
  ])
  assert.equal(label('Worn Blanket'), 'Worn Blanket · A Few RIMs')
  assert.equal(label('Rare Spike'), 'Rare Spike · 100-2.4k Diamonds by color')
  assert.equal(label('Elf Tail'), 'Elf Tail · varies by color') // no rate for its units
  assert.equal(label('Big Thing'), 'Big Thing · 42k Diamonds') // too long as written
  assert.equal(label('Long Thing'), 'Long Thing · 1 Bad Long Collar + 1 Black…')
  assert.equal(label('Fox Hat'), 'Fox Hat · 2 RIMs')
  assert.equal(label('Play'), null)
  assert.equal(label('Worn Blanket · A Few RIMs'), null) // never labeled twice
  // With a name list, only listed item names are touched.
  const names = itemNames({ clothing: new Map([['1', { name: 'Fox Hat' }]]), den: new Map() })
  assert.equal(label('Worn Blanket', names), null)
  assert.equal(label('Fox Hat', names), 'Fox Hat · 2 RIMs')
  assert.equal(shortValue('a'.repeat(29)), null)
})

function startOrigin (body) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.includes('missing')) { res.writeHead(404); return res.end() }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(body)
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }))
  })
}

test('game server: a content file the filter wants is changed; failures send the original', async () => {
  const pack = zlib.deflateRawSync(amf3(PACK))
  const origin = await startOrigin(pack)
  let mode = 'ok'
  const logs = []
  const gs = new GameServer({
    proxyPort: () => 1,
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jr-worth-')),
    log: e => logs.push(e),
    contentFilter: {
      wants: (name) => name.endsWith('/defPacks/strings'),
      apply: async (name, buf) => {
        if (mode === 'throw') throw new Error('boom')
        return rewriteStrings(buf, editor({ 'Worn Blanket': 'Worn Blanket · A Few RIMs' })).buf
      }
    }
  })
  await gs.listen()
  try {
    await fetch(gs.url + '/game/session', { method: 'POST', body: JSON.stringify({ smartfoxServer: 'a.animaljam.com', content: origin.base + '/', deploy_version: '1' }) })
    const get = async (p) => Buffer.from(await (await fetch(gs.url + '/content/' + p)).arrayBuffer())

    assert.equal(decodePack(await get('1/defPacks/strings'))[100], 'Worn Blanket · A Few RIMs')
    assert.deepEqual(await get('1/defPacks/other'), pack) // not wanted: untouched
    mode = 'throw'
    assert.deepEqual(await get('1/defPacks/strings'), pack)
    assert.ok(logs.some(e => e.type === 'warn' && /unchanged/.test(e.message)))
    const missing = await fetch(gs.url + '/content/1/missing/defPacks/strings')
    assert.equal(missing.status, 404)
  } finally {
    await gs.close()
    origin.server.close()
  }
})
