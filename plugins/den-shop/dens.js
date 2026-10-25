'use strict'

/**
 * Den Shop, by BradysLabs: reads the game's den data and builds the buy
 * packets. Kept apart from the window so it can be tested.
 *
 * Data comes from the game's own files (JR's item loader fetches them):
 *   1040   den types (name, Gem cost, members only)
 *   1054   the Diamond Shop (which shop entries are dens, and their Diamond cost)
 *   10230  text strings (names)
 * Buying:  %xt%o%db%<room>%-1%384%<id>%<den slot>%<0 Gems / 1 Diamonds>%
 *          Gems use the den's id, Diamonds use its Diamond Shop entry id.
 * Answer:  %xt%db%-1%<1 bought / 0 refused>%<balance>%...
 * Diamond dens for sale now: ask %xt%o%gl%<room>%214%, answered by list 214.
 */

const PACKS = { dens: '1040', diamondShop: '1054', strings: '10230' }
const DIAMOND_LIST = 214
// Dens the game doesn't sell for Gems carry a placeholder price this high.
const NOT_FOR_GEMS = 10000

/** A pack as a list of entries, whatever shape it came in. */
function entriesOf (pack) {
  if (!pack) return []
  if (pack instanceof Map) return [...pack.entries()].map(([k, v]) => withId(v, k))
  if (Array.isArray(pack)) return pack.filter(e => e && typeof e === 'object')
  if (typeof pack === 'object') {
    const values = Object.entries(pack)
    // A wrapper object around one big list.
    const lists = values.filter(([, v]) => Array.isArray(v) && v.length && typeof v[0] === 'object')
    if (lists.length === 1 && values.length <= 3) return entriesOf(lists[0][1])
    return values.filter(([, v]) => v && typeof v === 'object').map(([k, v]) => withId(v, k))
  }
  return []
}
function withId (e, key) {
  if (!e || typeof e !== 'object') return e
  return e.id === undefined && /^\d+$/.test(String(key)) ? { ...e, id: key } : e
}

function lookupString (strings, id) {
  if (id === undefined || id === null || !strings) return null
  if (strings instanceof Map) return strings.get(id) || strings.get(String(id)) || strings.get(Number(id)) || null
  const v = strings[id]
  return typeof v === 'string' ? v : null
}

const truthy = (v) => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true'
const firstKey = (e, re) => Object.keys(e).find(k => re.test(k))

/** The fields of an entry, so a format we don't know can be reported. */
function describe (pack) {
  const e = entriesOf(pack)[0]
  return e ? Object.keys(e).join(', ') : 'no entries'
}

/**
 * Den types from pack 1040: Map(id -> { id, name, gems, members }).
 * Throws with the field names if the format isn't recognised.
 */
function readDens (pack, strings) {
  const out = new Map()
  for (const e of entriesOf(pack)) {
    const id = Number(e.id)
    if (!Number.isInteger(id) || id <= 0) continue
    const nameKey = firstKey(e, /^(name|title)Str(Id|Ref)$/i) || firstKey(e, /Str(Id|Ref)$/i)
    const costKey = ['cost', 'gemCost', 'price'].find(k => e[k] !== undefined) || firstKey(e, /cost/i)
    const memberKey = firstKey(e, /member/i)
    const statusKey = firstKey(e, /^(status|availability|isHidden|hidden)$/i)
    const name = (nameKey && lookupString(strings, e[nameKey])) || e.name || e.abbrName || null
    const gems = costKey ? Number(e[costKey]) || 0 : 0
    const status = statusKey ? Number(e[statusKey]) || (truthy(e[statusKey]) ? 1 : 0) : 0
    out.set(id, {
      id,
      name: name ? String(name) : `Den #${id}`,
      named: !!name,
      gems,
      members: memberKey ? truthy(e[memberKey]) : false,
      status,
      // Sold for Gems: has a real Gem price and isn't hidden.
      forGems: gems > 0 && gems < NOT_FOR_GEMS && !status
    })
  }
  if (!out.size) throw new Error(`Couldn't read the den list (fields: ${describe(pack)}).`)
  return out
}

/**
 * Diamond Shop entries that are dens, from pack 1054:
 * Map(shop entry id -> { shopId, denId, diamonds }).
 * The entry names its den in one of its id fields; we find which field by
 * checking against the real den list.
 */
function readDiamondDens (pack, dens) {
  const entries = entriesOf(pack)
  if (!entries.length || !dens || !dens.size) return new Map()
  const refKeys = [...new Set(entries.flatMap(e => Object.keys(e)))]
    .filter(k => k !== 'id' && /(def|item|ref|den|reward|prize)/i.test(k) && /id$/i.test(k))
  const typeKey = [...new Set(entries.flatMap(e => Object.keys(e)))].find(k => /type/i.test(k) && !/currency/i.test(k))
  // Which type value means "den": the one whose entries point at real dens most often.
  let best = null
  for (const ref of refKeys) {
    const byType = new Map()
    for (const e of entries) {
      const t = typeKey ? String(e[typeKey]) : '*'
      const hit = dens.has(Number(e[ref]))
      const b = byType.get(t) || { hits: 0, total: 0 }
      b.total++; if (hit) b.hits++
      byType.set(t, b)
    }
    for (const [t, b] of byType) {
      const score = b.hits / b.total
      if (b.hits >= 1 && score >= 0.8 && (!best || b.hits > best.hits)) best = { ref, type: t, hits: b.hits }
    }
  }
  const out = new Map()
  if (!best) return out
  for (const e of entries) {
    if (typeKey && String(e[typeKey]) !== best.type) continue
    const denId = Number(e[best.ref])
    if (!dens.has(denId)) continue
    const costKey = firstKey(e, /diamond/i) || firstKey(e, /cost|price/i)
    out.set(Number(e.id), { shopId: Number(e.id), denId, diamonds: costKey ? Number(e[costKey]) || 0 : 0 })
  }
  return out
}

/** The Diamond Shop entry ids for sale now, from list 214, or null if it's another list. */
function readDiamondList (value) {
  const parts = (Array.isArray(value) ? value : String(value || '').split('%')).map(String).filter(Boolean)
  if (parts[1] !== 'gl' || Number(parts[3]) !== DIAMOND_LIST) return null
  const count = parseInt(parts[9], 10)
  if (!(count > 0)) return []
  return parts.slice(10, 10 + count).map(Number).filter(n => Number.isInteger(n) && n > 0)
}

function listRequest (room) { return `%xt%o%gl%${room == null ? -1 : room}%${DIAMOND_LIST}%` }

/** The packet that buys a den. */
function buyPacket ({ room, id, slot, diamonds }) {
  const n = Number(slot)
  if (!room) throw new Error('Join a room in Animal Jam first.')
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new Error('Pick a den slot number (1 or more).')
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) throw new Error('Pick a den.')
  return `%xt%o%db%${room}%-1%384%${Number(id)}%${n}%${diamonds ? 1 : 0}%`
}

/** The answer to a purchase: { ok, balance, extra }, or null if it isn't one. */
function readBuyReply (value) {
  const parts = (Array.isArray(value) ? value : String(value || '').split('%')).map(String).filter(Boolean)
  if (parts[1] !== 'db') return null
  return { ok: parts[3] === '1', balance: parts[4] != null ? parts[4] : null, extra: parts.slice(5) }
}

/** Likely reasons the game refused, most likely first. */
function refusalHints (den, { member } = {}) {
  const hints = []
  if (den && den.members && member === false) hints.push('it\u2019s for members only')
  hints.push('the den slot isn\u2019t empty')
  if (den && !den.diamonds && den.forGems === false) hints.push('the game doesn\u2019t sell this den for Gems')
  hints.push(`you don\u2019t have enough ${den && den.diamonds ? 'Diamonds' : 'Gems'}`)
  return hints
}

module.exports = { PACKS, DIAMOND_LIST, NOT_FOR_GEMS, entriesOf, readDens, readDiamondDens, readDiamondList, listRequest, buyPacket, readBuyReply, refusalHints, describe }
