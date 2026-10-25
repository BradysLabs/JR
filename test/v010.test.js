'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.join(__dirname, '..')
const { createPricer } = require('../src/worth/pricer')
const { parseDenItems } = require('../plugins/inventory-worth-capture')
const { buildReport, scrub } = require('../src/ui/bugreport')

const items = (clothing = {}, den = {}) => ({
  ready: true,
  getClothing: (id) => clothing[id] || null,
  getDenItem: (id) => den[id] || null
})

test('pricer: values den items from the real wiki list, in Diamonds', () => {
  const p = createPricer({ root, items: items({}, { 10: { name: 'Rare Stone Chair' } }) })
  const v = p.value({ kind: 'den', id: 10 })
  assert.ok(v.diamonds, 'Rare Stone Chair has a wiki value')
  assert.ok(v.diamonds.min >= 1 && v.diamonds.max <= 50)
  assert.match(p.format(v.diamonds), /^≈ \d/)
})

test('pricer: unknown items have no value, and prices are sensible', () => {
  const p = createPricer({ root, items: items({}, { 11: { name: 'Definitely Not A Real Item 123' } }), worthItems: [] })
  assert.equal(p.value({ kind: 'den', id: 11 }).diamonds, null)
  assert.equal(p.value({ kind: 'pet', id: 1 }).diamonds, null)
  assert.equal(p.suggestedPrice({ min: 400, max: 450 }), 425)
  assert.equal(p.suggestedPrice({ min: 2, max: 3 }), 3)
  assert.equal(p.format({ min: 1, max: 1 }), '≈ 1 Diamond')
  assert.equal(p.format({ min: 400, max: 450 }), '≈ 400–450 Diamonds · 1 BL')
})

test('inventory reader: den list with mannequins, before and after item names load', () => {
  const manq = ['1', '500', '1', '0', 'true', '', '0', '', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '0']
  const lamp = ['2', '994', '0', '3', 'true', '', '0', '', '0']
  const v = ['', 'xt', 'di', '-1', '0', '2', '0', ...manq, ...lamp]
  const blind = parseDenItems(v)
  assert.deepEqual(blind.map(d => [d.invId, d.defId, d.version]), [[1, 500, 0], [2, 994, 3]])
  const known = parseDenItems(v, (id) => (id === 500 ? { specialType: 4 } : { name: 'x' }))
  assert.deepEqual(known, blind)
})

test('bug report: includes the useful details and removes secrets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-report-'))
  fs.mkdirSync(path.join(dir, 'logs'))
  fs.writeFileSync(path.join(dir, 'logs', 'jr.log'), 'line one\nauth_token=abc123 and me@example.com\nlast line\n')
  fs.writeFileSync(path.join(dir, 'logs', 'packets.log'), '%xt%o%dsi%1%Seller%151%\n')
  const engine = {
    settings: { theme: 'ocean', antiKick: true, packetsPerSecond: 20 },
    gameServer: { session: { upstream: { host: 'lb-iss01.animaljam.com' }, version: '1830' } },
    dispatch: { connected: true, getState: () => 'jamaa_township.room_main' },
    items: { ready: true, deployVersion: '1830' },
    gameRunning: true,
    host: { list: () => [{ name: 'Glow Picker', status: 'ready' }, { name: 'Shop', status: 'error', errors: ['broke'] }] }
  }
  const text = buildReport({ info: { version: '0.1.0', profile: { name: 'Main' }, dataDir: dir }, engine, note: 'Shop froze' })
  assert.match(text, /Version\s+0\.1\.0/)
  assert.match(text, /Shop froze/)
  assert.match(text, /Glow Picker\s+ready/)
  assert.match(text, /Shop\s+error · broke/)
  assert.match(text, /last line/)
  assert.match(text, /%xt%o%dsi%1%Seller%151%/)
  assert.doesNotMatch(text, /abc123|me@example\.com/)
  assert.equal(scrub('"password":"hunter2"'), '"password":"[hidden]"')
})

test('pricer: wiki pictures named after a different item keep its value off this one', () => {
  const den = { 1: { name: 'Crocodile Plushie' }, 2: { name: 'Exclusive Crocodile Plushie' } }
  const p = createPricer({ root, items: { ...items({}, den), den: new Map(Object.entries(den)), clothing: new Map() } })
  assert.equal(p.value({ kind: 'den', id: 1 }).diamonds, null) // the plain 50-gem plushie
  const exclusive = p.value({ kind: 'den', id: 2 })
  assert.ok(exclusive.diamonds && exclusive.diamonds.min >= 300, 'Exclusive Crocodile Plushie gets the McDonald\'s value')
})

test('pricer: wiki pictures tell every Headdress color apart', () => {
  // The game's real Headdress palette (layer colors) for its 8 colors.
  const layers = {
    1: [0x762626, 0x263876, 0xffec95, 0x426b31],
    2: [0x333333, 0xffffff, 0x82a58b, 0x426b31],
    3: [0xd57740, 0xffec95, 0xffffff, 0x426b31],
    4: [0xa05aaf, 0xfaf8ca, 0xee94ac, 0x426b31],
    5: [0x6175b9, 0xffffff, 0xcccccc, 0x426b31],
    6: [0xcd8f9f, 0xffffff, 0xeed8e6, 0x426b31],
    7: [0x853e5a, 0xffffff, 0x82a58b, 0x426b31],
    8: [0x346851, 0xffffff, 0xcccccc, 0x426b31]
  }
  const clothing = { 5: { name: 'Headdress', colors: Object.keys(layers).map(Number) } }
  const db = { ...items(clothing), clothing: new Map(Object.entries(clothing)), den: new Map(), layerColors: (c) => layers[c] }
  const p = createPricer({ root, items: db })
  const got = Object.keys(layers).map(c => p.value({ kind: 'clothing', id: 5, color: Number(c) }).color)
  assert.deepEqual(got, ['Tan', 'Black', 'Orange', 'Dark Pink', 'Blue', 'Light Pink', 'Magenta', 'Silver'])
  for (const c of Object.keys(layers)) assert.ok(p.value({ kind: 'clothing', id: 5, color: Number(c) }).diamonds)
})

test('pricer: Rare Headdress uses the Rare Item Monday row', () => {
  const clothing = { 6: { name: 'Rare Headdress', colors: [1] } }
  const p = createPricer({ root, items: { ...items(clothing), clothing: new Map(Object.entries(clothing)), den: new Map() } })
  const v = p.value({ kind: 'clothing', id: 6, color: 1 })
  assert.ok(v.diamonds && v.diamonds.min >= 2000, 'about 6 Black Long Collars')
})

test('picture matcher: one-to-one assignment', () => {
  const { assign } = require('../src/worth/picture')
  assert.deepEqual(assign([[1, 9, 9], [9, 9, 1]]), [0, 2])
  assert.deepEqual(assign([[5, 1], [1, 5]]), [1, 0])
})
