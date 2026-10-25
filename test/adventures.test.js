'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const ADVENTURES = require('../plugins/adventure-runner/adventures')

// Runs an adventure's steps against a fake ctx and returns what it sent.
async function runSteps (adventure, choices = [], prizeScreen = false) {
  const sent = []
  const waits = []
  const ctx = {
    send: async (packet) => { sent.push(packet) },
    pickup: async (name) => { sent.push(`%xt%o%qpup%{room}%${name}%{player}%`) },
    trigger: async (name) => { sent.push(`%xt%o%qat%{room}%${name}%0%`) },
    wait: async (ms) => { waits.push(ms) },
    choices,
    newPrize: () => { sent.push('<new prize>') },
    collectPrize: async (ms) => { sent.push(`<collect prize, up to ${ms}ms>`); return prizeScreen },
    active: () => [],
    objects: () => [],
    log: () => {},
    status: () => {}
  }
  for (const step of adventure.steps) await step.run(ctx)
  return { sent, waits }
}

test('every adventure is well formed', () => {
  const ids = new Set()
  for (const a of ADVENTURES) {
    assert.ok(a.id && a.name && Array.isArray(a.modes) && a.modes.length, a.name)
    assert.ok(Number.isInteger(a.questId), `${a.name} questId`)
    assert.ok(!ids.has(a.id), `duplicate id ${a.id}`)
    ids.add(a.id)
    for (const s of a.steps) assert.ok(s.label && typeof s.run === 'function', `${a.name} step`)
  }
})

test('Tiki Trouble: solo, opens every chest, hands in three pearls with waits between', async () => {
  const tiki = ADVENTURES.find(a => a.id === 'tiki-trouble')
  assert.ok(tiki)
  assert.equal(tiki.questId, 40)
  assert.equal(tiki.solo, true)
  const { sent, waits } = await runSteps(tiki)
  assert.equal(sent[0], '%xt%o%qaskr%{room}%alpha0%0%1%')
  for (const chest of ['av_treasure', 'treasure1', 'treasure5']) {
    const touch = sent.indexOf(`%xt%o%qat%{room}%${chest}%0%`)
    assert.ok(touch > 0, chest)
    assert.equal(sent[touch + 1], `%xt%o%qatt%{room}%${chest}%1%`)
  }
  assert.equal(sent.filter(p => p === '%xt%o%qpup%{room}%tikipearl3%{player}%').length, 3)
  assert.equal(sent.filter(p => p === '%xt%o%qat%{room}%alpha1%0%').length, 3)
  assert.deepEqual(waits, [150000, 150000]) // between pearls, not after the last
})

test('Bitter Sweets: claims only the reward goals you tick, in order', async () => {
  const bs = ADVENTURES.find(a => a.id === 'bittersweets')
  assert.ok(bs, 'Bitter Sweets is switched on')
  assert.equal(bs.questId, 46)
  assert.deepEqual(bs.choices.options.map(o => o.id), ['goal1', 'goal2', 'goal3', 'goal4', 'goal5'])
  assert.deepEqual(bs.choices.defaults, ['goal1', 'goal2', 'goal3', 'goal4', 'goal5'])
  // Each goal's prize is collected before the next goal is claimed.
  const { sent, waits } = await runSteps(bs, ['goal3', 'goal1'])
  assert.deepEqual(sent, [
    '<new prize>', '%xt%o%qat%{room}%gui_goal1%0%', '<collect prize, up to 3000ms>',
    '<new prize>', '%xt%o%qat%{room}%gui_goal3%0%', '<collect prize, up to 3000ms>'
  ])
  assert.deepEqual(waits, [5000, 5000]) // no prize screen opened: still give the chests time
  // When a prize screen does open, it's handled there, with no extra wait.
  const withScreen = await runSteps(bs, ['goal1', 'goal2'], true)
  assert.deepEqual(withScreen.waits, [])
  assert.equal(withScreen.sent.filter(p => p.includes('gui_goal')).length, 2)
})
