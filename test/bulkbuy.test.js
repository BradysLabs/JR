'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Dispatch } = require('../src/engine/dispatch')
const { decode } = require('../src/engine/codec')
const { BulkBuyer, readPurchase } = require('../plugins/bulk-buy/bulk')

function setup () {
  const d = new Dispatch()
  const sent = []
  d.session = { toServer: (t) => sent.push(t), toGame: () => {} }
  d.setState('room', '1763249')
  return { d, sent, server: (t) => d.process(decode(t, 'in')), game: (t) => d.process(decode(t, 'out')) }
}

// Real capture: buying Pumpkin Shoes.
const BUY = '%xt%o%ib%1763249%11%1%1037%2%0%-1%%'

test('bulk buy: remembers what you bought, but not dens', () => {
  assert.deepEqual(readPurchase(BUY) && [readPurchase(BUY).kind, readPurchase(BUY).defId], ['clothing', 1037])
  assert.equal(readPurchase('%xt%o%db%55%-1%384%12%3%0%'), null) // a den: needs a free slot
  assert.equal(readPurchase('%xt%o%db%55%-1%201%994%0%').kind, 'den')
  assert.equal(readPurchase('%xt%o%ka%55%'), null)
})

test('bulk buy: repeats the exact purchase in the room you\'re in, and stops when the game says no', async () => {
  const { d, sent, server, game } = setup()
  const b = new BulkBuyer({ dispatch: d, wait: async () => {} })
  await game(BUY)
  assert.equal(b.last.defId, 1037)
  d.setState('room', '999') // moved rooms since
  sent.length = 0
  const answers = (async () => {
    for (const ok of ['1', '1', '0']) {
      const before = sent.length
      while (sent.length === before) await new Promise(r => setTimeout(r, 2))
      const reply = decode(`%xt%ib%999%${ok}%11%${ok === '1' ? 155000 : 0}%0%`, 'in')
      await d.process(reply)
      assert.equal(reply.send, false) // kept from the game
    }
  })()
  const r = await b.buy(5)
  await answers
  assert.deepEqual(sent, Array(3).fill('%xt%o%ib%999%11%1%1037%2%0%-1%%'))
  assert.deepEqual([r.done, r.refused, r.balance], [2, true, '155000'])
  b.dispose()
})

test('bulk buy: needs a purchase first, and gives up if the game never answers', async () => {
  const { d, game } = setup()
  const b = new BulkBuyer({ dispatch: d, wait: async () => {} })
  await assert.rejects(b.buy(3), /Buy one in Animal Jam first/)
  await game(BUY)
  // Don't wait 6 real seconds: check the message instead by stopping the timer early.
  const real = global.setTimeout
  global.setTimeout = (fn) => real(fn, 5)
  try { await assert.rejects(b.buy(2), /No answer from the game after 0 bought/) } finally { global.setTimeout = real }
  b.dispose()
})
