'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const abc = require('../src/game/abc')
const swf = require('../src/game/swf')
const { createWorthLookup } = require('../src/worth/bubble')
const { GameServer } = require('../src/game/server')

test('bytecode: inserting code corrects every jump around it', () => {
  //  0: pushtrue          (26)
  //  1: iffalse +5 -> 10  (12 05 00 00)
  //  5: pushfalse         (27)
  //  6: jump -10 -> 0     (10 F6 FF FF)
  // 10: returnvoid        (47)
  const code = Buffer.from([0x26, 0x12, 0x05, 0x00, 0x00, 0x27, 0x10, 0xF6, 0xFF, 0xFF, 0x47])
  const before = abc.decode(code)
  assert.deepEqual(before.map(i => i.at), [0, 1, 5, 6, 10])
  assert.equal(before[1].branches[0].target, 10)
  assert.equal(before[3].branches[0].target, 0)

  // Two no-ops just before returnvoid: the forward jump to 10 skips them.
  const out = abc.insertCode(code, 10, [0x02, 0x02])
  const after = abc.decode(out)
  assert.equal(after.find(i => i.at === 1).branches[0].target, 12) // still the returnvoid
  assert.equal(after.find(i => i.at === 6).branches[0].target, 0)
  assert.equal(out[12], 0x47)

  // Inserting before a jump's source moves the source, not a target before it.
  const out2 = abc.insertCode(code, 5, [0x02])
  const after2 = abc.decode(out2)
  assert.equal(after2.find(i => i.at === 1).branches[0].target, 11)
  assert.equal(after2.find(i => i.at === 7).branches[0].target, 0)
  assert.throws(() => abc.insertCode(code, 3, [0x02]), /not an instruction boundary/)
})

const SWF = process.env.AJ_SWF || path.join(__dirname, '..', 'ajclient-1830-jr3.swf')

test('item hover patch on the real game file (if available)', { skip: !fs.existsSync(SWF) }, () => {
  const original = fs.readFileSync(SWF)
  const result = swf.patchClient(original, { itemHover: true })
  assert.equal(result.itemHover, 'patched')
  const { body } = swf.unpack(result.swf)
  assert.equal(result.swf.readUInt32LE(4), body.length + 8)
  for (const tag of swf.tags(body)) {
    if (tag.code !== 82) continue
    let start = tag.dataStart + 4
    while (body[start] !== 0) start++
    start++
    const A = abc.parse(body, start)
    assert.equal(A.end, tag.dataStart + tag.length) // the whole block still reads to its end
    // Every method still decodes, and every jump lands on an instruction.
    for (const b of A.bodies.values()) {
      const code = body.subarray(b.codeStart, b.codeStart + b.codeLength)
      const list = abc.decode(code)
      const starts = new Set(list.map(i => i.at))
      for (const i of list) for (const br of i.branches) assert.ok(starts.has(br.target), 'jump into the middle of an instruction')
    }
    const over = abc.findMethod(A, 'ItemWindowBase', 'onWindowRollOver')
    const text = body.subarray(over.codeStart, over.codeStart + over.codeLength)
    assert.ok(A.strings.includes('jrItemOver') && A.strings.includes('jrItemOut'))
    assert.ok(over.maxStack >= 9)
    assert.equal(text[text.length - 1], 0x47)
  }
  // Without the option the file is as before.
  assert.equal(swf.patchClient(original).itemHover, 'off')
})

const offer = (text) => [{ text, min: 1, max: 1, unit: 'Diamonds', knownUnit: true }]
const WORTH = [
  { id: 'a', page: 'Rare Spike', name: 'Rare Spike', variant: 'Black', raw: '100 Diamonds', offers: offer('100 Diamonds'), editedAt: '2026-05-01T00:00:00Z', url: 'https://aj-item-worth.fandom.com/wiki/Rare_Spike' },
  { id: 'b', page: 'Rare Spike', name: 'Rare Spike', variant: 'White', raw: '2400 Diamonds', offers: offer('2400 Diamonds'), editedAt: '2026-06-01T00:00:00Z' },
  { id: 'c', page: 'Worn Blanket', name: 'Worn Blanket', variant: null, raw: '1 Diamond', offers: offer('1 Diamond') }
]
const db = {
  clothing: new Map([['50', { name: 'Worn Blanket' }]]),
  den: new Map(),
  getClothing (id) { return this.clothing.get(String(id)) || null },
  getDenItem () { return null }
}

test('worth lookup: one item, its value, and what it covers', () => {
  const lookup = createWorthLookup({ worthItems: WORTH, db })
  const blanket = lookup({ defId: 50, color: 0, name: 'Worn Blanket · 1 Diamond' })
  assert.equal(blanket.name, 'Worn Blanket')
  assert.equal(blanket.matched, true)
  assert.deepEqual(blanket.diamonds, { min: 1, max: 1 })

  const spike = lookup({ defId: 9999, color: 0, name: 'Rare Spike' }) // not in the item lists: by name
  assert.equal(spike.scope, 'all versions')
  assert.deepEqual(spike.diamonds, { min: 100, max: 2400 })
  assert.equal(spike.updated, '2026-06-01')
  assert.equal(spike.lines.length, 2)

  assert.deepEqual(lookup({ defId: 1, color: 0, name: 'Nothing Like It' }), { found: true, name: 'Nothing Like It', color: null, matched: false })
  assert.deepEqual(lookup({}), { found: false })
})

test('game server answers /jr/worth for the bubble', async () => {
  const lookup = createWorthLookup({ worthItems: WORTH, db })
  const gs = new GameServer({ proxyPort: () => 1, cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jr-bubble-')), worthLookup: async (q) => lookup(q) })
  await gs.listen()
  try {
    const r = await fetch(gs.url + '/jr/worth?defId=50&color=0&name=Worn%20Blanket')
    assert.equal(r.headers.get('access-control-allow-origin'), '*')
    const d = await r.json()
    assert.equal(d.name, 'Worn Blanket')
    assert.deepEqual(d.diamonds, { min: 1, max: 1 })
  } finally {
    await gs.close()
  }
})
