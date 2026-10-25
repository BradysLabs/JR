'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Dispatch } = require('../src/engine/dispatch')
const { Advertiser, chatPacket, cleanMessage, nextGap } = require('../plugins/auto-advertise/advertise')

function setup () {
  const d = new Dispatch()
  const sent = []
  d.session = { toServer: (t) => sent.push(t), toGame: () => {} }
  d.setState('room', '7882775')
  const queue = []
  const timers = { set: (fn, ms) => { queue.push({ fn, ms }); return queue.length }, clear: () => {} }
  // Runs the next message timer (skips the 5 second "did it show up" checks).
  const tick = () => { const i = queue.findIndex(t => t.ms !== 5000); const t = i === -1 ? null : queue.splice(i, 1)[0]; if (t) t.fn(); return t }
  return { d, sent, timers, queue, tick }
}

test('advertise: chat packet, cleaned messages and the 30 second floor', () => {
  // Exactly what the game sends (real capture), with JR's text.
  assert.equal(chatPacket('1767900', 'hello'), "<msg t='sys'><body action='pubMsg' r='1767900'><txt><![CDATA[hello%9]]></txt></body></msg>")
  assert.equal(cleanMessage('  hi\n there %8 <b>]]>  '), 'hi there 8 b')
  assert.equal(cleanMessage('x'.repeat(300)).length, 100)
  assert.throws(() => chatPacket(null, 'hi'), /Join a room/)
  assert.equal(nextGap({ min: 5, max: 10 }, () => 0), 30) // can't go under 30
  assert.equal(nextGap({ min: 60, max: 90 }, () => 0.5), 75)
  assert.equal(nextGap({ min: 60, max: 20 }, () => 1), 60)
})

test('advertise: takes turns through the messages, then stops when you leave the room', () => {
  const { d, sent, timers, queue, tick } = setup()
  const a = new Advertiser({ dispatch: d, timers })
  a.start({ messages: ['one', 'two', '', 'three'], min: 60, max: 60 })
  tick(); tick(); tick()
  const said = sent.map(p => /CDATA\[(.*)%9\]\]/.exec(p)[1])
  assert.deepEqual(said, ['one', 'two', 'three', 'one'])
  assert.ok(queue.filter(t => t.ms !== 5000).every(t => t.ms === 60000))
  d.setState('room', '999')
  tick()
  assert.equal(a.running, null)
  assert.match(a.stoppedBecause, /left the room/)
  assert.equal(sent.length, 4)
})

test('advertise: random order never repeats a line twice in a row; needs messages', () => {
  const { d, sent, timers, tick } = setup()
  const a = new Advertiser({ dispatch: d, timers })
  assert.throws(() => a.start({ messages: ['  '] }), /at least one message/)
  a.start({ messages: ['a', 'b', 'c'], order: 'random', stayInRoom: false })
  for (let i = 0; i < 30; i++) tick()
  const said = sent.map(p => /CDATA\[(.*)%9\]\]/.exec(p)[1])
  for (let i = 1; i < said.length; i++) assert.notEqual(said[i], said[i - 1])
  a.stop()
})

test('advertise: counts messages the server says back, and flags ones that never show up', async () => {
  const { d, timers, queue } = setup()
  const { decode } = require('../src/engine/codec')
  const a = new Advertiser({ dispatch: d, timers })
  a.start({ messages: ['hello', 'buy my stuff'], min: 60, max: 60 })
  // The server says "hello" back (real capture format).
  await d.process(decode('%xt%uc%7882775%766252%hello%9%0%', 'in'))
  assert.equal(a.running.shown, 1)
  // Next message: no echo. The 5 second check fires.
  queue.shift().fn() // the 5s check for "hello", already answered: nothing
  queue.shift().fn() // the next message, "buy my stuff"
  const check = queue.find(t => t.ms === 5000)
  check.fn()
  assert.equal(a.running.blocked, 1)
  assert.equal(a.running.lastBlocked, 'buy my stuff')
  a.dispose()
})
