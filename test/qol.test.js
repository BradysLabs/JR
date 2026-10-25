'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const qol = require('../src/ui/qol')

const pk = (type, raw) => ({ type, raw })

test('network filter: show, hide, and hide wins', () => {
  const all = [pk('ka', '%xt%o%ka%1%'), pk('umo', '%xt%o%umo%1%5%'), pk('rj', '%xt%rj%-1%jamaa_township%'), pk('ti', '%xt%ti%1%0%Seller%')]
  const names = (f) => all.filter(f).map(p => p.type)
  assert.deepEqual(names(qol.packetFilter()), ['ka', 'umo', 'rj', 'ti'])
  assert.deepEqual(names(qol.packetFilter({ show: 'rj' })), ['rj'])
  assert.deepEqual(names(qol.packetFilter({ show: 'jamaa' })), ['rj'])
  assert.deepEqual(names(qol.packetFilter({ hide: 'ka, umo' })), ['rj', 'ti'])
  assert.deepEqual(names(qol.packetFilter({ hide: 'ka umo' })), ['rj', 'ti'])
  assert.deepEqual(names(qol.packetFilter({ show: 'rj', hide: 'township' })), [])
  assert.equal(qol.addHideTerm('ka', 'UMO'), 'ka, umo')
  assert.equal(qol.addHideTerm('ka, umo', 'ka'), 'ka, umo')
  assert.equal(qol.addHideTerm('', 'ka'), 'ka')
})

test('console: tab completes command names', () => {
  const names = ['membership', 'membership-level', 'denlog', 'help']
  assert.deepEqual(qol.completeCommand('den', names), { value: 'denlog ', matches: ['denlog'] })
  assert.equal(qol.completeCommand('mem', names).value, 'membership')
  assert.deepEqual(qol.completeCommand('membership', names).matches, ['membership', 'membership-level'])
  assert.equal(qol.completeCommand('membership', names).value, 'membership')
  assert.equal(qol.completeCommand('zzz', names).value, 'zzz')
  assert.equal(qol.completeCommand('denlog on', names).value, 'denlog on')
  assert.equal(qol.completeCommand('HE', names).value, 'help ')
})

test('console: history skips blanks and repeats and stays short', () => {
  let h = []
  for (const line of ['a', 'a', ' ', 'b', 'a']) h = qol.pushHistory(h, line, 3)
  assert.deepEqual(h, ['a', 'b', 'a'])
  assert.deepEqual(qol.pushHistory(null, 'x'), ['x'])
  assert.equal(qol.pushHistory(Array.from({ length: 150 }, (_, i) => String(i)), 'new').length, 100)
})

test('windows reopen where they were, unless that is off screen', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  assert.deepEqual(qol.placeWindow({ x: 100, y: 50, width: 1200, height: 800 }, area), { x: 100, y: 50, width: 1200, height: 800 })
  // A monitor that's gone: keep the size, let Windows pick the spot.
  assert.deepEqual(qol.placeWindow({ x: 3000, y: 50, width: 1200, height: 800 }, area), { width: 1200, height: 800 })
  // Bigger than the screen now: shrink to fit; never below the minimum.
  assert.deepEqual(qol.placeWindow({ x: 0, y: 0, width: 4000, height: 3000 }, area), { x: 0, y: 0, width: 1920, height: 1040 })
  assert.deepEqual(qol.placeWindow({ x: 0, y: 0, width: 200, height: 100 }, area), { x: 0, y: 0, width: 860, height: 600 })
  assert.deepEqual(qol.placeWindow(null, area), {})
  assert.deepEqual(qol.placeWindow({ x: 0, y: 0, width: 'big' }, area), {})
})

test('zoom steps up, down and back', () => {
  assert.equal(qol.nextZoom(1, 1), 1.1)
  assert.equal(qol.nextZoom(1, -1), 0.9)
  assert.equal(qol.nextZoom(1.5, 1), 1.5)
  assert.equal(qol.nextZoom(0.67, -1), 0.67)
  assert.equal(qol.nextZoom(1.25, 0), 1)
  assert.equal(qol.nextZoom(undefined, 1), 1.1)
})

test("what's new shows once per version, and this version has notes", () => {
  const notes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'whats-new.json'), 'utf8'))
  const version = require('../package.json').version
  const entry = qol.whatsNewFor(notes, version, '0.0.1')
  assert.ok(entry, `whats-new.json needs notes for ${version}`)
  for (const it of entry.items) assert.ok(it.title && it.text)
  assert.equal(qol.whatsNewFor(notes, version, version), null)
  assert.equal(qol.whatsNewFor(notes, '9.9.9', '0.0.1'), null)
})

test('plugin errors read cleanly', () => {
  assert.equal(qol.cleanError("Uncaught (in promise) TypeError: Cannot destructure property 'run' of 'window.SpammerRunner'"), "TypeError: Cannot destructure property 'run' of 'window.SpammerRunner'")
  assert.equal(qol.cleanError('Uncaught ReferenceError: x is not defined'), 'ReferenceError: x is not defined')
  assert.equal(qol.cleanError(''), 'Unknown error')
})
