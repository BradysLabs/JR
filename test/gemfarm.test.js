'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Dispatch } = require('../src/engine/dispatch')
const { decode } = require('../src/engine/codec')
const { GemFarm } = require('../plugins/gem-farm/farm')

function setup (room = '1234') {
  const d = new Dispatch()
  const sent = []
  d.session = { toServer: (t) => sent.push(t), toGame: () => {} }
  if (room) d.setState('room', room)
  return { d, sent }
}

test('gem farm: opens adventure 49 once, then loops goal 4 and both gifts', async () => {
  const { d, sent } = setup()
  let waits = 0
  const farm = new GemFarm({ dispatch: d, wait: async () => { if (++waits === 7) farm.stop() } })
  await farm.start({ delay: 500 })
  assert.deepEqual(sent.slice(0, 4), [
    '%xt%o%qj%1234%Z%49%0%0%',
    '%xt%o%qat%1234%gui_goal4%0%',
    '%xt%o%qpgiftplr%1234%0%0%0%',
    '%xt%o%qpgiftplr%1234%1%0%0%'
  ])
  assert.equal(sent.filter(p => p.includes('gui_goal4')).length, 2)
  assert.equal(farm.stats.cycles, 1) // the second round was stopped part way
  assert.equal(farm.running, false)
  farm.dispose()
})

test('gem farm: needs a room, and stops when you leave it', async () => {
  const { d } = setup(null)
  const farm = new GemFarm({ dispatch: d, wait: async () => {} })
  await assert.rejects(farm.start(), /Join a room/)
  d.setState('room', '9')
  let waits = 0
  farm.wait = async () => { if (++waits === 2) d.setState('room', null) }
  await assert.rejects(farm.start(), /Left the room/)
  farm.dispose()
})

test('gem farm: recycles prize items as they arrive, but not other items or when off', async () => {
  const { d, sent } = setup()
  let release
  const farm = new GemFarm({ dispatch: d, wait: () => new Promise(resolve => { release = resolve }) })
  const run = farm.start()
  await new Promise(resolve => setImmediate(resolve))
  // %xt%il%-1%... with 14 fields: slot at 11, item at 12.
  const itemAdded = (slot, id) => d.process(decode(`%xt%il%-1%0%1%1%Seller%0%1%0%${slot}%${id}%`, 'in'))
  await itemAdded(77, 860)
  await itemAdded(78, 439)
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(sent.includes('%xt%o%ir%1234%77%'))
  assert.ok(!sent.includes('%xt%o%ir%1234%78%'))
  assert.equal(farm.stats.recycled, 1)
  farm.recycle = false
  await itemAdded(79, 861)
  assert.ok(!sent.includes('%xt%o%ir%1234%79%'))
  farm.stop(); release(); await run
  farm.dispose()
})
