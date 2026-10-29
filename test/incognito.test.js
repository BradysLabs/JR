'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Dispatch } = require('../src/engine/dispatch')
const { decode } = require('../src/engine/codec')
const { createIncognito, cleanName, swapper } = require('../src/game/rename')

const LOGIN = '{"t":"xt","b":{"r":-1,"o":{"_cmd":"login","params":{"userName":"Bryson123","avName":"Bryson123"},"status":"1"}}}'

function setup (alias = 'Coolcat') {
  const dispatch = new Dispatch({ packetsPerSecond: 100 })
  dispatch.session = { toGame () {}, toServer () {} }
  const incognito = createIncognito({ dispatch, alias: () => alias })
  const run = async (text, dir) => (await dispatch.process(decode(text, dir))).toMessage()
  return { dispatch, incognito, run }
}

test('incognito: the game is told your Display Name, Animal Jam still gets your username', async () => {
  const { dispatch, incognito, run } = setup()
  const login = JSON.parse(await run(LOGIN, 'in'))
  assert.equal(login.b.o.params.userName, 'Coolcat')
  assert.equal(dispatch.getState('player').userName, 'Bryson123')
  assert.deepEqual(incognito.ids(), ['Bryson123', 'Coolcat'])
  assert.equal(await run('%xt%rj%-1%1%denbryson123%55%', 'in'), '%xt%rj%-1%1%denCoolcat%55%')
  assert.equal(await run('%xt%ua%Bryson123 sent you a gift%0%', 'in'), '%xt%ua%Coolcat sent you a gift%0%')
  assert.equal(await run('%xt%o%rj%5%denCoolcat%', 'out'), '%xt%o%rj%5%denBryson123%')
  assert.equal(await run('%xt%o%bu%5%coolcat%', 'out'), '%xt%o%bu%5%Bryson123%')
  // other names, and your name inside longer words, are left alone
  assert.equal(await run('%xt%ua%Bryson1234 and xBryson123%0%', 'in'), '%xt%ua%Bryson1234 and xBryson123%0%')
})

test('incognito: off when there is no Display Name, and after disconnecting', async () => {
  const off = setup('')
  assert.equal(JSON.parse(await off.run(LOGIN, 'in')).b.o.params.userName, 'Bryson123')
  const on = setup()
  await on.run(LOGIN, 'in')
  on.dispatch.session = null
  on.dispatch.emit('disconnected')
  assert.equal(on.incognito.session, null)
})

test('incognito: names are cleaned', () => {
  assert.equal(cleanName('  Cool%cat <3  99 '), 'Coolcat 3 99')
  assert.equal(cleanName('x'.repeat(30)).length, 20)
  assert.equal(swapper('a.b', 'Z')('aXb a.b'), 'aXb Z')
})
