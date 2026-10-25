'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const D = require('../plugins/den-shop/dens')

// Shaped like the game's packs as JR's loader returns them (keyed by id).
const strings = new Map([['501', 'Small House'], ['502', 'Tree House'], ['503', 'Sunken Ship']])
const denPack = {
  1: { id: '1', nameStrId: '501', cost: '2000', membersOnly: '0' },
  2: { id: '2', nameStrId: '502', cost: '4000', membersOnly: '1' },
  8: { id: '8', nameStrId: '503', cost: '2500', membersOnly: '0' },
  99: { id: '99', nameStrId: '999', cost: '0', membersOnly: '0' }
}
const shopPack = {
  700: { id: '700', itemType: '3', itemDefId: '2', diamondCost: '10' },
  701: { id: '701', itemType: '3', itemDefId: '8', diamondCost: '7' },
  702: { id: '702', itemType: '1', itemDefId: '1', diamondCost: '5' } // clothing #1, not a den
}

test('den shop: reads dens with names, Gem cost and members', () => {
  const dens = D.readDens(denPack, strings)
  assert.deepEqual(dens.get(2), { id: 2, name: 'Tree House', named: true, gems: 4000, members: true, status: 0, forGems: true })
  assert.equal(dens.get(1).members, false)
  assert.equal(dens.get(99).name, 'Den #99')
  // Also as a Map or a plain list.
  assert.equal(D.readDens(new Map(Object.entries(denPack)), strings).size, 4)
  assert.equal(D.readDens(Object.values(denPack), strings).get(8).gems, 2500)
  assert.throws(() => D.readDens({}, strings), /fields: no entries/)
})

test('den shop: finds which Diamond Shop entries are dens', () => {
  const dens = D.readDens(denPack, strings)
  const dia = D.readDiamondDens(shopPack, dens)
  assert.deepEqual([...dia.keys()].sort(), [700, 701])
  assert.deepEqual(dia.get(700), { shopId: 700, denId: 2, diamonds: 10 })
  assert.equal(D.readDiamondDens(null, dens).size, 0)
})

test('den shop: the for-sale list, buy packets and replies', () => {
  assert.deepEqual(D.readDiamondList('%xt%gl%-1%214%a%b%c%d%e%3%700%701%9%'), [700, 701, 9])
  assert.equal(D.readDiamondList('%xt%gl%-1%215%a%b%c%d%e%1%700%'), null)
  assert.equal(D.listRequest('123'), '%xt%o%gl%123%214%')
  assert.equal(D.buyPacket({ room: '123', id: 2, slot: 3, diamonds: false }), '%xt%o%db%123%-1%384%2%3%0%')
  assert.equal(D.buyPacket({ room: '123', id: 700, slot: '1', diamonds: true }), '%xt%o%db%123%-1%384%700%1%1%')
  assert.throws(() => D.buyPacket({ room: null, id: 2, slot: 1 }), /Join a room/)
  assert.throws(() => D.buyPacket({ room: '1', id: 2, slot: 0 }), /slot/)
  assert.deepEqual(D.readBuyReply('%xt%db%-1%1%12345%'), { ok: true, balance: '12345', extra: [] })
  assert.deepEqual(D.readBuyReply('%xt%db%-1%0%%'), { ok: false, balance: null, extra: [] })
  assert.equal(D.readBuyReply('%xt%dx%-1%1%'), null)
})

test('den shop: dens the game doesn\'t sell for Gems are marked', () => {
  const pack = {
    1: { id: '1', nameStrId: '501', cost: '2000', membersOnly: '0', status: '0' },
    9: { id: '9', nameStrId: '502', cost: '10', membersOnly: '0', status: '5' }, // hidden
    30: { id: '30', nameStrId: '503', cost: '25000', membersOnly: '1', status: '0' } // placeholder price
  }
  const dens = D.readDens(pack, strings)
  assert.deepEqual([...dens.values()].map(d => [d.id, d.forGems]), [[1, true], [9, false], [30, false]])
  // No status field at all still works.
  assert.equal(D.readDens({ 1: { id: '1', cost: '2000' } }).get(1).forGems, true)
})

test('den shop: refusal hints and reply details', () => {
  assert.deepEqual(D.readBuyReply('%xt%db%-1%0%123%NSLOT%'), { ok: false, balance: '123', extra: ['NSLOT'] })
  const hints = D.refusalHints({ diamonds: false, forGems: false, members: true }, { member: false })
  assert.equal(hints[0], 'it\u2019s for members only')
  assert.ok(hints.some(h => /doesn.t sell this den for Gems/.test(h)))
  assert.match(D.refusalHints({ diamonds: true }).slice(-1)[0], /Diamonds/)
})
