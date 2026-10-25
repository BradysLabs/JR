'use strict'

/**
 * Recycling, by BradysLabs: works out what a recycle preset would recycle
 * from your inventory, and the packets that do it.
 *
 *   Clothing:  %xt%o%ir%<room>%<inventory slot>%
 *   Den items: %xt%o%dr%<room>%0%<inventory slot>%
 *
 * Never touched: clothing you're wearing, anything in one of your shops,
 * den items placed in your den, shop stands and mannequins.
 */

const MAX_PER_RUN = 500

/** A preset entry's key, e.g. "clothing:857". */
const keyOf = (kind, defId) => `${kind}:${Number(defId)}`

/** Why an item can't be recycled, or null if it can. */
function protectedReason (kind, item) {
  if (kind === 'clothing') {
    if (item.equipped) return 'wearing'
    if (item.shop) return 'in a shop'
  } else {
    if (item.placed) return 'placed in your den'
    if (item.shop) return 'in a shop'
    if (item.stand) return 'shop stand'
    if (item.mannequin) return 'mannequin'
  }
  return null
}

/**
 * What recycling these preset entries would do now.
 * @param {{clothing: Map, den: Map}} inventory slot -> item
 * @param {{kind: 'clothing'|'den', defId: number, keep?: number}[]} entries
 * @returns {{recycle: {kind, slot, defId}[], byEntry: {key, owned, safe, keep, recycle}[]}}
 */
function planRecycle (inventory, entries) {
  const wanted = new Map()
  for (const e of entries || []) {
    if (!e || (e.kind !== 'clothing' && e.kind !== 'den') || !(Number(e.defId) > 0)) continue
    wanted.set(keyOf(e.kind, e.defId), Math.max(0, Math.floor(Number(e.keep) || 0)))
  }
  const found = new Map() // key -> { owned, safe: [slot...] }
  for (const kind of ['clothing', 'den']) {
    const map = inventory && inventory[kind]
    if (!map) continue
    for (const [slot, item] of map) {
      const key = keyOf(kind, item.defId)
      if (!wanted.has(key)) continue
      const f = found.get(key) || { owned: 0, safe: [] }
      f.owned++
      if (!protectedReason(kind, item)) f.safe.push(Number(slot))
      found.set(key, f)
    }
  }
  const recycle = []
  const byEntry = []
  for (const [key, keep] of wanted) {
    const [kind, id] = key.split(':')
    const f = found.get(key) || { owned: 0, safe: [] }
    // "Keep" counts every copy you own, so protected ones count as kept first.
    const protectedCount = f.owned - f.safe.length
    const canGo = Math.max(0, f.safe.length - Math.max(0, keep - protectedCount))
    const slots = f.safe.sort((a, b) => b - a).slice(0, canGo) // newest slots first
    for (const slot of slots) recycle.push({ kind, slot, defId: Number(id) })
    byEntry.push({ key, kind, defId: Number(id), owned: f.owned, safe: f.safe.length, keep, recycle: slots.length })
  }
  return { recycle: recycle.slice(0, MAX_PER_RUN), byEntry, capped: recycle.length > MAX_PER_RUN }
}

function recyclePacket (room, { kind, slot }) {
  if (!room) throw new Error('Join a room in Animal Jam first.')
  return kind === 'den' ? `%xt%o%dr%${room}%0%${slot}%` : `%xt%o%ir%${room}%${slot}%`
}

/** Reads a preset someone shared ("JR-RECYCLE:" + base64 JSON). */
function decodePreset (text) {
  const m = /JR-RECYCLE:([A-Za-z0-9+/=_-]+)/.exec(String(text || ''))
  if (!m) throw new Error('That isn’t a JR recycle preset.')
  let data
  try { data = JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) } catch (_) { throw new Error('That preset is damaged.') }
  return cleanPreset(data)
}
function encodePreset (preset) {
  const p = cleanPreset(preset)
  return 'JR-RECYCLE:' + Buffer.from(JSON.stringify({ name: p.name, items: p.items }), 'utf8').toString('base64')
}
function cleanPreset (p) {
  const items = (Array.isArray(p && p.items) ? p.items : [])
    .filter(e => e && (e.kind === 'clothing' || e.kind === 'den') && Number(e.defId) > 0)
    .map(e => ({ kind: e.kind, defId: Math.floor(Number(e.defId)), keep: Math.max(0, Math.floor(Number(e.keep) || 0)) }))
    .filter((e, i, a) => a.findIndex(x => x.kind === e.kind && x.defId === e.defId) === i)
    .slice(0, 300)
  return { name: String((p && p.name) || 'Shared preset').slice(0, 40), items }
}

module.exports = { planRecycle, recyclePacket, protectedReason, keyOf, encodePreset, decodePreset, cleanPreset, MAX_PER_RUN }
