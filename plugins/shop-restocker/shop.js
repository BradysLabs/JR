'use strict'

/**
 * My Shop templates, by BradysLabs.
 *
 * Keeps track of your clothing, den items and My Shop stands from the game's
 * own messages, saves a shop's contents as a template, and puts matching
 * items from your inventory back into a shop from a template.
 *
 * Message layouts (indexes into the split packet, where [2] is the command):
 *   il  you  [4]=0 full list, [7]=username, [10]=count, then per item from [11]:
 *            defId, invIdx, color, equipped avatars (bitfield, "0" = none), shop it's in (0 = none)
 *   il  you  [4]=2 changes, [8]=color, [9]=added, [10]=removed, then (invIdx, defId) per add, invIdx per removal
 *   di       [5]=count, then per item from [7]: invIdx, defId, placed (0 = in storage), version,
 *            approved, image, number, text, [10 more for mannequins], shop it's in
 *   dsi  out %xt%o%dsi%<room>%<owner>%<shop>%
 *        in  [4]=status, [5]=count (-1 = none), [6]=version code, then per item from [7]:
 *            currency, price, kind, invIdx, defId           (when you ask about your own shop)
 *   dsu  out %xt%o%dsu%<room>%<shop>%<version code>%<added>%(kind, invIdx, currency, price)*%<removed>%(kind, invIdx)*%
 *        in  [4]=1 ok, [5]=new version code
 *   dsb  in  [4]=1, [5]=shop owner, [6]=shop; when the owner is you (a sale):
 *            [7]=currency, [8]=price, [9]=kind, [10]=invIdx, [11]=defId
 * Kinds in shop messages: 2 clothing, 0 den item, 1 pet. Currency: 3 Diamonds, 0 Gems.
 *
 * JR never removes anything from your shop: it only adds items.
 */

const KIND = { clothing: 2, den: 0, pet: 1 }
const KIND_NAME = { 2: 'clothing', 0: 'den', 1: 'pet' }
const recycle = require('./recycle')
const SHOP_STAND = 5 // den item specialType of My Shop stands
const MANNEQUIN = 4
const REPLY_TIMEOUT = 10000

const int = (v) => (/^-?\d+$/.test(String(v)) ? Number(v) : NaN)
const nowIso = () => new Date().toISOString()

/** %xt%o%dsu%<room>%<shop>%<version>%<n>%(kind, invIdx, currency, price)*%<m>%(kind, invIdx)*% */
function parseUpdate (v) {
  if (!Array.isArray(v)) return null
  // Outgoing packets have the extra "o": ['', 'xt', 'o', 'dsu', room, shop, version, count, ...]
  const shopId = int(v[5])
  let i = 7
  const added = []
  const removed = []
  const nAdd = Math.max(0, int(v[i++]) || 0)
  for (let n = 0; n < nAdd && i + 3 < v.length; n++, i += 4) added.push({ kind: KIND_NAME[int(v[i])], invIdx: int(v[i + 1]), currency: int(v[i + 2]), cost: int(v[i + 3]) })
  const nRemove = Math.max(0, int(v[i++]) || 0)
  for (let n = 0; n < nRemove && i + 1 < v.length; n++, i += 2) removed.push({ kind: KIND_NAME[int(v[i])], invIdx: int(v[i + 1]) })
  return { shopId, added, removed }
}

class ShopService {
  /**
   * @param {object} options
   * @param {object} options.dispatch JR dispatch (plugin view)
   * @param {object} options.items JR item database (getClothing, getDenItem)
   * @param {{get: Function, set: Function}} options.storage
   * @param {(ms: number) => Promise<void>} [options.wait]
   */
  constructor ({ dispatch, items, storage, wait, restockDelay = 3000, replyTimeout = REPLY_TIMEOUT, notify, log }) {
    this.logTo = typeof log === 'function' ? log : null // JR's Logs page
    this.replyTimeout = replyTimeout
    this.notify = typeof notify === 'function' ? notify : null // desktop notification for sales
    this.dispatch = dispatch
    this.items = items || {}
    this.storage = storage
    this.wait = wait || ((ms) => new Promise(resolve => setTimeout(resolve, ms)))
    this.restockDelay = restockDelay

    this.clothing = new Map() // invIdx -> { defId, color, equipped, shop }
    this.den = new Map() // invIdx -> { defId, version, placed, shop }
    this.shops = new Map() // shop invIdx -> { defId, items, version, checkedAt }
    this.haveClothing = false
    this.haveDen = false
    this.pending = [] // who asked for each outstanding reply: { cmd, from: 'game'|'jr', resolve }
    this.inFlight = null // JR's own request while it waits for the answer
    this.held = [] // the game's shop requests, held back until JR's answer arrives
    this.rawDen = null // the last den item list, read again once item names load
    this.denReadWithNames = false
    this.busy = null
    this.activity = []
    this.timers = new Map()

    this.templates = this._load('templates', [])
    this.auto = this._load('auto', {}) // shop -> { templateId, when: 'sale'|'empty' }
    this.names = this._load('names', {}) // shop -> your own name for it (only shown in JR)
    const sales = this._load('sales', [])
    this.sales = Array.isArray(sales) ? sales.filter(s => s && typeof s === 'object') : [] // newest first
    this.visit = null // the den you're in: { owner, room, stands, shops, scan }
    this.late = new Map() // cmd -> times JR gave up on an answer that may still come
    this.look = new Map() // slot (negative) -> eyes/pattern id you're wearing
    this.lookKnown = false // whether JR has seen your eyes/pattern this session
    this.colors = null // your animal's colors, once JR has seen them
    this.ownReplies = { iu: 0, ap: 0 } // answers to JR's own requests, kept from the game
    this.autoRecycle = null // { name, entries } while auto-recycle is on (this session only)
    this.recycling = null // { total, done } during a recycle run
    this.recycleLog = [] // newest first

    const on = (type, message, fn) => dispatch.onMessage({ type, message, callback: ({ message: m }) => fn(m) })
    on('aj', 'il', (m) => this._onItemList(m.value))
    on('aj', 'di', (m) => this._onDenItems(m.value))
    on('aj', 'ds', (m) => this._onDenVisit(m.value))
    on('aj', 'dsi', (m) => this._onReply('dsi', m))
    on('aj', 'dsu', (m) => this._onReply('dsu', m))
    on('aj', 'dsb', (m) => this._onBuy(m.value))
    on('aj', 'login', () => this._reset())
    // The game's own shop requests, so their replies still reach the game.
    // The game's own shop requests, so their replies still reach the game.
    // While JR is waiting for an answer, the game's requests wait their turn,
    // so the server's answers can't get mixed up between JR and the game.
    on('connection', 'ap', (m) => this._onColors(m.value))
    on('aj', 'iu', (m) => this._swallowOwn('iu', m))
    on('aj', 'ap', (m) => this._swallowOwn('ap', m))
    on('connection', 'dsi', (m) => this._gameRequest('dsi', m))
    on('connection', 'dsu', (m) => this._gameRequest('dsu', m))
  }

  /* ------------------------------------------------------------ helpers */

  _load (key, fallback) {
    try {
      const v = this.storage.get(key, fallback)
      return v == null ? fallback : v
    } catch (_) { return fallback }
  }

  _save () {
    this.storage.set('templates', this.templates)
    this.storage.set('auto', this.auto)
    this.storage.set('names', this.names)
  }

  /** Your name for a shop, or the game's name for the stand. */
  shopName (shopId, fallback) {
    return this.names[shopId] || fallback || 'My Shop'
  }

  /** Names a shop in JR. An empty name goes back to the stand's own name. */
  renameShop (shopId, name) {
    const clean = String(name || '').trim().slice(0, 40)
    if (clean) this.names[shopId] = clean
    else delete this.names[shopId]
    this._save()
    return clean
  }

  _me () {
    const p = this.dispatch.getState('player') || {}
    return String(p.userName || p.username || p.screenName || this.username || '').toLowerCase()
  }

  _note (text, kind = 'info') {
    this.activity.unshift({ at: nowIso(), text, kind })
    this.activity.length = Math.min(this.activity.length, 40)
  }

  _reset () {
    this.clothing.clear(); this.den.clear(); this.shops.clear()
    this.haveClothing = this.haveDen = false
    this.pending = []
    this.held = []
    this.inFlight = null
    this.rawDen = null
    this.look = new Map(); this.lookKnown = false; this.colors = null
  }

  itemName (kind, defId) {
    try {
      const def = kind === 'den' ? this.items.getDenItem && this.items.getDenItem(defId) : this.items.getClothing && this.items.getClothing(defId)
      if (def && def.name) return def.name
    } catch (_) {}
    return `${kind === 'den' ? 'Den item' : 'Item'} #${defId}`
  }

  /* -------------------------------------------------------- inventory */

  _onItemList (v) {
    if (!Array.isArray(v)) return
    const code = String(v[4])
    if (code === '0') {
      const user = String(v[7] || '').toLowerCase()
      const me = this._me()
      if (me && user !== me) return
      if (!me) this.username = user
      const count = Math.max(0, Math.min(20000, int(v[10]) || 0))
      const next = new Map()
      let i = 11
      const look = new Map()
      for (let n = 0; n < count && i + 4 < v.length; n++, i += 5) {
        const defId = int(v[i]); const invIdx = int(v[i + 1])
        // Eyes and patterns are worn like items, in negative slots.
        if (invIdx < 0 && defId > 0) { if (!/^0*$/.test(String(v[i + 3] || ''))) look.set(invIdx, defId); continue }
        if (!(defId > 0) || !(invIdx >= 0)) continue
        next.set(invIdx, {
          defId,
          color: Number(v[i + 2]) >>> 0,
          equipped: !/^0*$/.test(String(v[i + 3] || '')),
          shop: int(v[i + 4]) || 0
        })
      }
      this.clothing = next
      this.haveClothing = true
      if (look.size) { this.look = look; this.lookKnown = true }
    } else if (code === '3') {
      this._onWear(v)
    } else if (code === '2' && this.haveClothing) {
      const color = Number(v[8]) >>> 0
      const added = Math.max(0, int(v[9]) || 0)
      const removed = Math.max(0, int(v[10]) || 0)
      let i = 11
      const fresh = []
      for (let n = 0; n < added && i + 1 < v.length; n++, i += 2) {
        const invIdx = int(v[i]); const defId = int(v[i + 1])
        if (invIdx >= 0 && defId > 0) { this.clothing.set(invIdx, { defId, color, equipped: false, shop: 0 }); fresh.push(invIdx) }
      }
      if (fresh.length) this._autoRecycle('clothing', fresh)
      for (let n = 0; n < removed && i < v.length; n++, i++) this.clothing.delete(int(v[i]))
    }
  }

  /**
   * Something was put on or taken off: %xt%il%-1%3%...%<user>%0%<on>%<off>%
   * then <slot>%<item> for each thing put on and <slot> for each taken off.
   * Negative slots are eyes and patterns.
   */
  _onWear (v) {
    const on = Math.max(0, int(v[9]) || 0)
    const off = Math.max(0, int(v[10]) || 0)
    let i = 11
    for (let n = 0; n < on && i + 1 < v.length; n++, i += 2) {
      const slot = int(v[i]); const defId = int(v[i + 1])
      if (slot < 0) { this.look.set(slot, defId); this.lookKnown = true } else { const c = this.clothing.get(slot); if (c) c.equipped = true }
    }
    for (let n = 0; n < off && i < v.length; n++, i++) {
      const slot = int(v[i])
      if (slot < 0) this.look.delete(slot); else { const c = this.clothing.get(slot); if (c) c.equipped = false }
    }
  }

  _onColors (v) {
    const colors = (v || []).slice(5, 9).map(Number)
    if (colors.length === 4 && colors.every(Number.isFinite)) this.colors = colors
  }

  _log (text) {
    try { if (this.logTo) this.logTo(`Outfits: ${text}.`) } catch (_) {}
  }

  /** Drops the game's answer to a request JR made, so the game isn't confused by it. */
  _swallowOwn (cmd, message) {
    if (this.ownReplies[cmd] > 0) {
      this.ownReplies[cmd]--
      message.send = false
      const waiter = this.replyWaiters && this.replyWaiters[cmd] && this.replyWaiters[cmd].shift()
      if (waiter) waiter(String((message.value || [])[4]) === '1')
    }
  }

  /** Sends one of JR's own requests and waits for the server's ok (true/false, or null if it never answers). */
  _askOwn (cmd, packet, timeout = 4000) {
    this.replyWaiters = this.replyWaiters || {}
    const list = this.replyWaiters[cmd] = this.replyWaiters[cmd] || []
    return new Promise((resolve) => {
      let done = false
      const finish = (ok) => { if (done) return; done = true; resolve(ok) }
      list.push(finish)
      this.ownReplies[cmd]++
      setTimeout(() => {
        const k = list.indexOf(finish)
        if (k !== -1) { list.splice(k, 1); this.ownReplies[cmd] = Math.max(0, this.ownReplies[cmd] - 1) }
        finish(null)
      }, timeout)
      Promise.resolve(this.dispatch.sendRemoteMessage(packet)).catch(() => finish(false))
    })
  }

  /**
   * Rejoins the room you're in, so the game reloads your animal (it doesn't
   * redraw colors JR changed otherwise). Dens use the den join packet.
   */
  async _reloadRoom () {
    const room = this.dispatch.getState('room')
    const name = String(this.dispatch.getState('roomName') || '')
    if (!room || !name) return false
    const packet = /^den./i.test(name)
      ? `%xt%o%dj%${room}%${name.toLowerCase()}%1%-1%`
      : `%xt%o%rj%${room}%${name.includes('#') ? name : name + '#1'}%1%0%0%`
    await this.dispatch.sendRemoteMessage(packet)
    return true
  }

  _onDenItems (v) {
    if (!Array.isArray(v)) return
    this.rawDen = v
    this.denReadWithNames = !!this.items.ready
    const count = Math.max(0, Math.min(20000, int(v[5]) || 0))
    const isFlag = (x) => x === 'true' || x === 'false'
    const next = new Map()
    let i = 7
    for (let n = 0; n < count && i + 8 < v.length; n++) {
      const invIdx = int(v[i]); const defId = int(v[i + 1])
      const placed = int(v[i + 2]) || 0
      const version = int(v[i + 3]) || 0
      const def = this.items.getDenItem && this.items.getDenItem(defId)
      // Mannequins carry 10 extra fields. Use the item list when it knows the
      // item; otherwise tell from where the next item's true/false field is.
      let size = 9
      if (def) {
        if (def.specialType === MANNEQUIN) size = 19
      } else if (n < count - 1 && !isFlag(v[i + 9 + 4]) && isFlag(v[i + 19 + 4])) {
        size = 19
      }
      const shop = int(v[i + size - 1]) || 0
      i += size
      if (invIdx >= 0 && defId > 0) next.set(invIdx, { defId, version, placed, shop, stand: !!(def && def.specialType === SHOP_STAND), mannequin: size === 19 })
    }
    // Den items that just arrived (an adventure prize, say), for auto-recycle.
    const fresh = this.haveDen ? [...next.keys()].filter(k => !this.den.has(k)) : []
    this.den = next
    this.haveDen = true
    if (fresh.length) this._autoRecycle('den', fresh)
  }

  /** Your My Shop stands, from your den items. */
  stands () {
    // Item names load after login; read the den list again once they have.
    if (this.rawDen && !this.denReadWithNames && this.items.ready) this._onDenItems(this.rawDen)
    const out = []
    for (const [invIdx, d] of this.den) {
      if (!d.stand) continue
      const known = this.shops.get(invIdx)
      const standName = this.itemName('den', d.defId)
      out.push({
        id: invIdx,
        name: this.shopName(invIdx, standName),
        standName,
        named: !!this.names[invIdx],
        placed: d.placed !== 0,
        count: known ? known.items.length : null,
        checkedAt: known ? known.checkedAt : null,
        auto: this.auto[invIdx] || null
      })
    }
    // Shops seen in messages but not (yet) in the den list.
    for (const [id, s] of this.shops) {
      if (!out.some(x => x.id === id)) out.push({ id, name: this.shopName(id), standName: 'My Shop', named: !!this.names[id], placed: true, count: s.items.length, checkedAt: s.checkedAt, auto: this.auto[id] || null })
    }
    return out.sort((a, b) => a.id - b.id)
  }

  /* ---------------------------------------------------------- requests */

  _gameRequest (cmd, message) {
    const v = message.value || []
    const entry = cmd === 'dsi'
      ? { cmd, from: 'game', owner: String(v[5] || '').toLowerCase(), shopId: int(v[6]) }
      : { cmd, from: 'game', change: parseUpdate(v) }
    if (this.inFlight) {
      // Hold it and send it right after JR's answer arrives.
      message.send = false
      const text = typeof message.toMessage === 'function' ? message.toMessage() : message.raw
      this.held.push({ entry, text })
      return
    }
    this.pending.push(entry)
  }

  _releaseHeld () {
    const held = this.held
    this.held = []
    for (const { entry, text } of held) {
      this.pending.push(entry)
      Promise.resolve(this.dispatch.sendRemoteMessage(text)).catch(() => {
        const k = this.pending.indexOf(entry)
        if (k !== -1) this.pending.splice(k, 1)
      })
    }
  }

  _onReply (cmd, message) {
    // An answer to a request JR already gave up on: drop it, so it isn't
    // taken as the answer to the next request or shown to the game.
    const late = this.late.get(cmd)
    if (late && late.count > 0 && Date.now() - late.at < LATE_WINDOW && !this.pending.some(p => p.cmd === cmd && p.from === 'game')) {
      late.count--
      message.send = false
      return
    }
    const i = this.pending.findIndex(p => p.cmd === cmd)
    if (i === -1) return
    const [p] = this.pending.splice(i, 1)
    if (p.from !== 'jr') {
      // Keep up with changes you make in the game's own shop screen.
      try {
        const v = message.value
        if (cmd === 'dsi' && p.owner && p.owner === this._me() && String(v[4]) === '1') this._applyShopInfo(p.shopId, v)
        if (cmd === 'dsu' && p.change && String(v[4]) === '1') this._applyUpdate(p.change, String(v[5] || ''))
      } catch (_) {}
      return
    }
    // The game didn't ask for this one; it would confuse its shop screen.
    message.send = false
    if (p.resolve) p.resolve(message.value)
  }

  async _ask (cmd, args, { timeout = this.replyTimeout, settle = 5000 } = {}) {
    const room = this.dispatch.getState('room')
    if (!room) throw new Error('Join a room in Animal Jam first.')
    // Let any request the game already sent get its answer first.
    for (let waited = 0; this.pending.length && waited < settle; waited += 100) await this.wait(100)
    if (this.pending.length) this.pending = [] // answers that never came; don't let them block the game
    const text = `%xt%o%${cmd}%${room}%${args.join('%')}%`
    return new Promise((resolve, reject) => {
      const entry = { cmd, from: 'jr', resolve: null }
      const finish = () => {
        clearTimeout(timer)
        const k = this.pending.indexOf(entry)
        if (k !== -1) this.pending.splice(k, 1)
        if (this.inFlight === entry) this.inFlight = null
        this._releaseHeld()
      }
      const timer = setTimeout(() => {
        // No answer: stop waiting so later answers go back to the game.
        const late = this.late.get(cmd) || { count: 0, at: 0 }
        if (Date.now() - late.at >= LATE_WINDOW) late.count = 0
        late.count++; late.at = Date.now()
        this.late.set(cmd, late)
        finish()
        reject(new Error('Animal Jam didn\u2019t answer for this shop. If it\u2019s in another den, go to that den and try again.'))
      }, timeout)
      entry.resolve = (value) => { finish(); resolve(value) }
      this.inFlight = entry
      this.pending.push(entry)
      Promise.resolve(this.dispatch.sendRemoteMessage(text)).catch((error) => { finish(); reject(error) })
    })
  }

  /** What's in one of your shops right now, from the server. */
  async readShop (shopId) {
    const me = this._me()
    if (!me) throw new Error('Log in to Animal Jam first.')
    const v = await this._ask('dsi', [me, shopId])
    if (String(v[4]) !== '1') throw new Error('Animal Jam couldn’t open that shop.')
    return this._applyShopInfo(shopId, v)
  }

  /** Reads a dsi answer about one of your shops. */
  _applyShopInfo (shopId, v) {
    shopId = Number(shopId)
    const count = int(v[5])
    const items = []
    let version = ''
    if (count > 0 || count === 0) {
      version = v.length > 6 ? String(v[6] || '') : ''
      let i = 7
      for (let n = 0; n < count && i + 4 < v.length; n++, i += 5) {
        const kind = KIND_NAME[int(v[i + 2])] || 'other'
        const invIdx = int(v[i + 3])
        const defId = int(v[i + 4])
        const item = { kind, invIdx, defId, currency: int(v[i]), cost: int(v[i + 1]) }
        if (kind === 'clothing') {
          const c = this.clothing.get(invIdx)
          if (c) { item.color = c.color; c.shop = shopId }
        } else if (kind === 'den') {
          const d = this.den.get(invIdx)
          if (d) { item.version = d.version; d.shop = shopId }
        }
        item.name = kind === 'pet' ? 'Pet' : this.itemName(kind, defId)
        items.push(item)
      }
    }
    // Anything JR thought was in this shop but isn't any more is free again.
    const listed = new Set(items.map(i => `${i.kind}:${i.invIdx}`))
    for (const [invIdx, c] of this.clothing) if (c.shop === shopId && !listed.has(`clothing:${invIdx}`)) c.shop = 0
    for (const [invIdx, d] of this.den) if (d.shop === shopId && !listed.has(`den:${invIdx}`)) d.shop = 0
    const shop = { items, version, checkedAt: nowIso() }
    this.shops.set(shopId, shop)
    return shop
  }

  /** Applies a change you made in the game's shop screen once the server accepts it. */
  _applyUpdate (change, version) {
    const inventory = (kind, invIdx) => (kind === 'clothing' ? this.clothing.get(invIdx) : kind === 'den' ? this.den.get(invIdx) : null)
    for (const a of change.added) { const inv = inventory(a.kind, a.invIdx); if (inv) inv.shop = change.shopId }
    for (const r of change.removed) { const inv = inventory(r.kind, r.invIdx); if (inv) inv.shop = 0 }
    const shop = this.shops.get(change.shopId)
    if (!shop) return
    shop.version = version
    shop.items = shop.items.filter(i => !change.removed.some(r => r.kind === i.kind && r.invIdx === i.invIdx))
    for (const a of change.added) {
      const old = shop.items.find(i => i.kind === a.kind && i.invIdx === a.invIdx)
      if (old) { old.currency = a.currency; old.cost = a.cost; continue }
      const inv = inventory(a.kind, a.invIdx)
      const defId = inv ? inv.defId : 0
      const item = { kind: a.kind, invIdx: a.invIdx, defId, currency: a.currency, cost: a.cost, name: a.kind === 'pet' ? 'Pet' : this.itemName(a.kind, defId) }
      if (a.kind === 'clothing' && inv) item.color = inv.color
      if (a.kind === 'den' && inv) item.version = inv.version
      shop.items.push(item)
    }
    shop.checkedAt = nowIso()
  }

  async _update (shopId, version, adds) {
    const args = [shopId, version, adds.length]
    for (const a of adds) args.push(KIND[a.kind], a.invIdx, a.currency, a.cost)
    args.push(0)
    const v = await this._ask('dsu', args)
    return { ok: String(v[4]) === '1', version: String(v[5] || '') }
  }

  /* --------------------------------------------------------- templates */

  /** Saves what's in a shop now as a new template. */
  async saveTemplate (shopId, name) {
    return this._exclusive(async () => {
      const shop = await this.readShop(shopId)
      const items = []
      let pets = 0
      for (const it of shop.items) {
        if (it.kind === 'pet') { pets++; continue }
        if (it.kind !== 'clothing' && it.kind !== 'den') continue
        const t = { kind: it.kind, defId: it.defId, name: it.name, currency: it.currency, cost: it.cost }
        if (it.kind === 'clothing' && it.color !== undefined) t.color = it.color
        if (it.kind === 'den' && it.version !== undefined) t.version = it.version
        items.push(t)
      }
      if (!items.length) throw new Error(pets ? 'That shop only has pets in it. Templates can hold clothing and den items.' : 'That shop is empty. Put items in it first, then save it.')
      const template = {
        id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: String(name || '').trim().slice(0, 40) || `Shop template ${this.templates.length + 1}`,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        items
      }
      this.templates.push(template)
      this._save()
      this._note(`Saved "${template.name}" (${items.length} item${items.length === 1 ? '' : 's'})${pets ? `; ${pets} pet${pets === 1 ? '' : 's'} left out` : ''}.`, 'good')
      return template
    })
  }

  renameTemplate (id, name) {
    const t = this._template(id)
    const clean = String(name || '').trim().slice(0, 40)
    if (!clean) throw new Error('Give the template a name.')
    t.name = clean
    t.updatedAt = nowIso()
    this._save()
    return t
  }

  deleteTemplate (id) {
    const t = this._template(id)
    this.templates = this.templates.filter(x => x !== t)
    for (const [shop, a] of Object.entries(this.auto)) if (a.templateId === id) delete this.auto[shop]
    this._save()
  }

  setPrice (id, index, cost, currency) {
    const t = this._template(id)
    const item = t.items[index]
    if (!item) throw new Error('That item isn’t in the template.')
    const n = Math.floor(Number(cost))
    if (!(n >= 1) || n > 1000000) throw new Error('Enter a price of 1 or more.')
    item.cost = n
    if (currency === 0 || currency === 3) item.currency = currency
    t.updatedAt = nowIso()
    this._save()
  }

  removeTemplateItem (id, index) {
    const t = this._template(id)
    t.items.splice(index, 1)
    t.updatedAt = nowIso()
    this._save()
  }

  setAuto (shopId, templateId, when = 'empty') {
    if (!templateId) delete this.auto[shopId]
    else {
      this._template(templateId)
      this.auto[shopId] = { templateId, when: when === 'sale' ? 'sale' : 'empty' }
    }
    this._save()
  }

  _template (id) {
    const t = this.templates.find(x => x.id === id)
    if (!t) throw new Error('That template no longer exists.')
    return t
  }

  /** How many of each template item you could list right now. */
  availability (id) {
    const t = this._template(id)
    const used = new Set()
    return t.items.map(item => {
      const free = this._freeMatches(item, used)
      return { owned: free.length }
    })
  }

  _freeMatches (item, taken) {
    const out = []
    if (item.kind === 'clothing') {
      for (const [invIdx, c] of this.clothing) {
        if (c.defId !== item.defId || c.shop || c.equipped || taken.has(`c${invIdx}`)) continue
        if (item.color !== undefined && c.color !== item.color) continue
        out.push(invIdx)
      }
    } else if (item.kind === 'den') {
      for (const [invIdx, d] of this.den) {
        if (d.defId !== item.defId || d.shop || d.placed || d.stand || taken.has(`d${invIdx}`)) continue
        if (item.version !== undefined && d.version !== item.version) continue
        out.push(invIdx)
      }
    }
    return out.sort((a, b) => b - a) // newest copies first
  }

  _sameItem (a, b) {
    if (a.kind !== b.kind || a.defId !== b.defId) return false
    if (a.kind === 'clothing' && a.color !== undefined && b.color !== undefined && a.color !== b.color) return false
    if (a.kind === 'den' && a.version !== undefined && b.version !== undefined && a.version !== b.version) return false
    return true
  }

  /**
   * Fills a shop back up to its template: every template item that isn't in
   * the shop already is listed again, using a matching item from your
   * inventory at the template's price.
   */
  async restock (shopId, templateId, { onlyIfEmpty = false } = {}) {
    return this._exclusive(async () => {
      const template = this._template(templateId)
      if (!this.haveClothing && template.items.some(i => i.kind === 'clothing')) throw new Error('JR hasn’t seen your clothing yet. Open your inventory in Animal Jam once, then try again.')
      if (!this.haveDen && template.items.some(i => i.kind === 'den')) throw new Error('JR hasn’t seen your den items yet. Go to your den once, then try again.')
      const shop = await this.readShop(shopId)
      if (onlyIfEmpty && shop.items.length) return { added: 0, missing: [], skipped: 'not-empty' }

      // Template items already in the shop count as filled.
      const inShop = shop.items.slice()
      const needed = []
      for (const item of template.items) {
        const k = inShop.findIndex(s => this._sameItem(item, s))
        if (k !== -1) inShop.splice(k, 1)
        else needed.push(item)
      }

      const taken = new Set()
      const adds = []
      const missing = []
      for (const item of needed) {
        const [invIdx] = this._freeMatches(item, taken)
        if (invIdx === undefined) { missing.push(item.name); continue }
        taken.add(`${item.kind === 'clothing' ? 'c' : 'd'}${invIdx}`)
        adds.push({ kind: item.kind, invIdx, currency: item.currency, cost: item.cost, name: item.name })
      }
      if (!adds.length) {
        const result = { added: 0, missing, full: needed.length === 0 }
        this._note(needed.length === 0 ? `${template.name}: the shop already matches the template.` : `${template.name}: nothing to add. Not in your inventory: ${missing.join(', ')}.`, needed.length ? 'warn' : 'info')
        return result
      }

      // All at once; if the server says no, one at a time to find which ones it won't take.
      let version = shop.version
      const listed = []
      const refused = []
      let r = await this._update(shopId, version, adds)
      if (r.ok) {
        listed.push(...adds)
        version = r.version
      } else {
        const fresh = await this.readShop(shopId)
        version = fresh.version
        for (const a of adds) {
          r = await this._update(shopId, version, [a])
          if (r.ok) { listed.push(a); version = r.version } else refused.push(a.name)
        }
      }
      for (const a of listed) {
        const inv = a.kind === 'clothing' ? this.clothing.get(a.invIdx) : this.den.get(a.invIdx)
        if (inv) inv.shop = Number(shopId)
      }
      try { await this.readShop(shopId) } catch (_) {}

      let text = `${template.name}: added ${listed.length} item${listed.length === 1 ? '' : 's'} to your shop.`
      if (missing.length) text += ` Not in your inventory: ${missing.join(', ')}.`
      if (refused.length) text += ` Animal Jam wouldn’t take: ${refused.join(', ')}.`
      this._note(text, refused.length || missing.length ? 'warn' : 'good')
      return { added: listed.length, missing, refused }
    })
  }

  async _exclusive (fn) {
    while (this.busy) { try { await this.busy } catch (_) {} }
    const run = fn()
    this.busy = run
    try { return await run } finally { if (this.busy === run) this.busy = null }
  }

  /* ------------------------------------------------------------- sales */

  _onBuy (v) {
    if (!Array.isArray(v) || String(v[4]) !== '1') return
    const me = this._me()
    if (!me || String(v[5] || '').toLowerCase() !== me) return
    // One of your items sold.
    const shopId = int(v[6])
    const kind = KIND_NAME[int(v[9])]
    const invIdx = int(v[10])
    const defId = int(v[11])
    if (kind === 'clothing') this.clothing.delete(invIdx)
    else if (kind === 'den') this.den.delete(invIdx)
    const shop = this.shops.get(shopId)
    if (shop) shop.items = shop.items.filter(i => !(i.invIdx === invIdx && i.kind === kind))
    const what = kind === 'pet' ? 'a pet' : this.itemName(kind, defId)
    const price = `${int(v[8])} ${int(v[7]) === 3 ? 'Diamonds' : 'Gems'}`
    this._note(`Sold: ${what} for ${price}.`)
    this._recordSale({ shopId, kind, defId, name: kind === 'pet' ? 'A pet' : this.itemName(kind, defId), cost: int(v[8]), currency: int(v[7]) === 3 ? 3 : 0 })
    if (this.notify) { try { this.notify({ title: 'Item sold', body: `${what.charAt(0).toUpperCase()}${what.slice(1)} for ${price}.` }) } catch (_) {} }

    const auto = this.auto[shopId]
    if (!auto) return
    // Wait a moment so several sales in a row become one refill.
    clearTimeout(this.timers.get(shopId))
    this.timers.set(shopId, setTimeout(() => {
      this.timers.delete(shopId)
      this.restock(shopId, auto.templateId, { onlyIfEmpty: auto.when === 'empty' })
        .catch(error => this._note(`Automatic refill failed: ${error.message}`, 'bad'))
    }, this.restockDelay))
  }

  /* ---------------------------------------------------------- outfits */

  /** What you're wearing now, to save as an outfit. */
  currentOutfit () {
    const clothing = [...this.clothing].filter(([, c]) => c.equipped)
      .map(([slot, c]) => ({ slot, defId: c.defId, color: c.color, name: this.itemName('clothing', c.defId) }))
    return {
      ready: this.haveClothing,
      clothing,
      look: this.lookKnown ? [...this.look].map(([slot, defId]) => ({ slot, defId })) : null,
      colors: this.colors ? this.colors.slice() : null
    }
  }

  /**
   * Puts on an outfit: takes off what isn't in it and puts on what is.
   * An item you no longer have in the same slot is matched by item and color.
   * @param {{clothing: {slot, defId, color}[], look?: {slot, defId}[]|null, colors?: number[]|null}} outfit
   * @param {{clothing?: boolean, look?: boolean}} parts which parts to put on
   */
  async wearOutfit (outfit, { clothing = true, look = false, reload = true } = {}) {
    const room = this.dispatch.getState('room')
    if (!room) throw new Error('Join a room in Animal Jam first.')
    if (!this.haveClothing) throw new Error('JR hasn\u2019t seen your clothing yet. Log in again.')
    const on = []; const off = []; const missing = []
    if (clothing) {
      const used = new Set()
      for (const want of outfit.clothing || []) {
        let slot = null
        const same = this.clothing.get(want.slot)
        if (same && same.defId === want.defId && !used.has(want.slot)) slot = want.slot
        else {
          for (const [s, c] of this.clothing) {
            if (!used.has(s) && c.defId === want.defId && (want.color == null || c.color === (Number(want.color) >>> 0))) { slot = s; break }
          }
        }
        if (slot == null) { missing.push(want.name || this.itemName('clothing', want.defId)); continue }
        used.add(slot)
        if (!this.clothing.get(slot).equipped) on.push(slot)
      }
      for (const [s, c] of this.clothing) if (c.equipped && !used.has(s)) off.push(s)
    }
    const lookOn = []; const lookOff = []
    if (look && Array.isArray(outfit.look)) {
      const wanted = new Set(outfit.look.map(l => Number(l.slot)))
      for (const l of outfit.look) if (!this.look.has(Number(l.slot))) lookOn.push(Number(l.slot))
      if (this.lookKnown) for (const s of this.look.keys()) if (!wanted.has(s)) lookOff.push(s)
    }
    // Take clothes off first, then put the outfit on: the server puts things
    // on before taking things off, so an item whose spot is still taken is
    // refused (seen in a real capture). Eyes and patterns swap in one go, the
    // way the game itself does it.
    const iu = (onList, offList) => `%xt%o%iu%${room}%${onList.length}%${offList.length}%${[...onList, ...offList].join('%')}%`
    const putOn = [...on, ...lookOn]; const takeOff = [...off, ...lookOff]
    if (off.length) {
      const ok = await this._askOwn('iu', iu([], off))
      this._log(`took off ${off.length} item${off.length === 1 ? '' : 's'}${ok === null ? ' (no answer)' : ok ? '' : ' (refused)'}`)
      await this.wait(OUTFIT_GAP)
    }
    if (putOn.length || lookOff.length) {
      const ok = await this._askOwn('iu', iu(putOn, lookOff))
      this._log(`put on ${putOn.length} item${putOn.length === 1 ? '' : 's'}${ok === null ? ' (no answer)' : ok ? '' : ' (refused)'}`)
      await this.wait(OUTFIT_GAP)
    }
    // What the server actually has on you now, to report anything it didn't put on.
    const notOn = on.filter(slot => { const c = this.clothing.get(slot); return !c || !c.equipped })
    let recolored = false
    let colorRefused = false
    let reloaded = false
    if (look && Array.isArray(outfit.colors) && outfit.colors.length === 4 && (!this.colors || outfit.colors.some((c, k) => c !== this.colors[k]))) {
      const ok = await this._askOwn('ap', `%xt%o%ap%${room}%${outfit.colors.join('%')}%`)
      this._log(`colors ${ok === null ? 'sent (no answer)' : ok ? 'accepted' : 'refused'}`)
      if (ok === false) colorRefused = true
      else {
        this.colors = outfit.colors.slice()
        recolored = true
        // The game only shows new colors after it reloads your animal.
        if (reload) {
          await this.wait(OUTFIT_GAP)
          reloaded = await this._reloadRoom()
          this._log(reloaded ? `rejoining ${this.dispatch.getState('roomName')} so your new colors show` : 'couldn\u2019t rejoin the room (JR doesn\u2019t know its name yet)')
        }
      }
    } else if (look && Array.isArray(outfit.colors)) {
      this._log('colors already match, not sent')
    }
    const notOnNames = notOn.map(slot => this.itemName('clothing', (this.clothing.get(slot) || {}).defId))
    return { putOn: putOn.length, tookOff: takeOff.length, recolored, colorRefused, reloaded, missing, notOn: notOnNames }
  }

  /* -------------------------------------------------------- recycling */

  /** Your clothing and den items, grouped by item, for the Recycle Tool. */
  inventory () {
    const group = (kind, map) => {
      const out = new Map()
      for (const item of map.values()) {
        const g = out.get(item.defId) || { kind, defId: item.defId, name: this.itemName(kind, item.defId), owned: 0, free: 0 }
        g.owned++
        if (!recycle.protectedReason(kind, item)) g.free++
        out.set(item.defId, g)
      }
      return [...out.values()]
    }
    return { ready: { clothing: this.haveClothing, den: this.haveDen }, items: [...group('clothing', this.clothing), ...group('den', this.den)] }
  }

  planRecycle (entries) {
    const plan = recycle.planRecycle({ clothing: this.clothing, den: this.den }, entries)
    for (const e of plan.byEntry) e.name = this.itemName(e.kind, e.defId)
    return plan
  }

  /** Recycles everything a preset matches right now. */
  async recycleNow (entries, { gap = RECYCLE_GAP, label = 'Recycle' } = {}) {
    if (this.recycling) throw new Error('Already recycling.')
    if (!this.haveClothing && !this.haveDen) throw new Error('JR hasn\u2019t seen your inventory yet. Log in again, or open your inventory in game.')
    const plan = recycle.planRecycle({ clothing: this.clothing, den: this.den }, entries)
    if (!plan.recycle.length) return { recycled: 0 }
    return this._recycle(plan.recycle, { gap, label })
  }

  async _recycle (list, { gap = RECYCLE_GAP, label }) {
    const run = { total: list.length, done: 0, stopped: false }
    this.recycling = run
    try {
      for (const it of list) {
        if (run.stopped) break
        const room = this.dispatch.getState('room')
        await this.dispatch.sendRemoteMessage(recycle.recyclePacket(room, it))
        if (it.kind === 'den') this.den.delete(it.slot); else this.clothing.delete(it.slot)
        run.done++
        await this.wait(gap)
      }
    } finally {
      this.recycling = null
    }
    const names = new Map()
    for (const it of list.slice(0, run.done)) { const n = this.itemName(it.kind, it.defId); names.set(n, (names.get(n) || 0) + 1) }
    const what = [...names].map(([n, c]) => (c > 1 ? `${c}\u00d7 ${n}` : n)).join(', ')
    if (run.done) {
      this.recycleLog.unshift({ at: nowIso(), label, count: run.done, what })
      this.recycleLog.length = Math.min(this.recycleLog.length, 30)
    }
    return { recycled: run.done, stopped: run.stopped, what }
  }

  stopRecycle () { if (this.recycling) this.recycling.stopped = true }

  /** Turns auto-recycle on (with a preset's entries) or off (null). This session only. */
  setAutoRecycle (preset) {
    this.autoRecycle = preset && Array.isArray(preset.entries) && preset.entries.length
      ? { name: String(preset.name || 'Preset'), entries: recycle.cleanPreset({ items: preset.entries }).items }
      : null
    return !!this.autoRecycle
  }

  _autoRecycle (kind, slots) {
    const auto = this.autoRecycle
    if (!auto || !this.dispatch.getState('room')) return
    const only = new Map([['clothing', new Map()], ['den', new Map()]])
    const map = kind === 'den' ? this.den : this.clothing
    for (const s of slots) if (map.has(s)) only.get(kind).set(s, map.get(s))
    // Keep counts look at everything you own, not just the new items.
    const plan = recycle.planRecycle({ clothing: this.clothing, den: this.den }, auto.entries)
    const list = plan.recycle.filter(it => it.kind === kind && only.get(kind).has(it.slot))
    if (!list.length) return
    const go = () => {
      if (this.recycling) { setTimeout(go, 500); return }
      this._recycle(list, { label: `Auto: ${auto.name}` }).catch(() => {})
    }
    setTimeout(go, 300)
  }

  recycleSnapshot () {
    return {
      auto: this.autoRecycle ? { name: this.autoRecycle.name, count: this.autoRecycle.entries.length } : null,
      running: this.recycling ? { total: this.recycling.total, done: this.recycling.done } : null,
      log: this.recycleLog.slice(0, 15)
    }
  }

  /* --------------------------------------------------- shop explorer */

  /** Entering a den: remember its owner and My Shop stands. */
  _onDenVisit (v) {
    if (!Array.isArray(v)) return
    const owner = this._denOwner()
    if (!owner) return
    const isStand = (defId) => {
      const def = this.items.getDenItem && this.items.getDenItem(defId)
      return def ? def.specialType === SHOP_STAND : defId === DEFAULT_STAND
    }
    const stands = readDenStands(v, isStand)
    const room = String(this.dispatch.getState('room') || '')
    // The game sends the den's items again now and then. Same den: keep
    // what's been read so far (and any scan going on).
    if (this.visit && this.visit.owner === owner) {
      this.visit.room = room
      if (stands.length) {
        this.visit.stands = stands
        for (const id of [...this.visit.shops.keys()]) if (!stands.some(s => s.id === id)) this.visit.shops.delete(id)
      }
      return
    }
    if (this.visit && this.visit.scan) this.visit.scan.stopped = true
    this.visit = { owner, room, stands, shops: new Map(), at: nowIso(), scan: null }
  }

  /** The owner of the den you're in now, from its room name ("den<name>"). */
  _denOwner () {
    const roomName = String(this.dispatch.getState('roomName') || '')
    return /^den./i.test(roomName) ? roomName.slice(3).toLowerCase() : null
  }

  _inVisitedDen () {
    return !!this.visit && this._denOwner() === this.visit.owner
  }

  /** Opens one stand in the den you're in and lists what's for sale. */
  async browseShop (standId) {
    const visit = this.visit
    if (!visit || !visit.owner) throw new Error('Go into a den with a My Shop first.')
    if (!this._inVisitedDen()) throw new Error('You left that den. Go back in and try again.')
    standId = Number(standId)
    const v = await this._ask('dsi', [visit.owner, standId], { timeout: EXPLORE_TIMEOUT })
    if (String(v[4]) !== '1') throw new Error('The game wouldn\u2019t open that shop.')
    const items = parseShopItems(v).map(it => ({ ...it, name: it.kind === 'pet' ? null : this.itemName(it.kind, it.defId) }))
    const shop = { items, checkedAt: nowIso() }
    visit.shops.set(standId, shop)
    return shop
  }

  /**
   * Opens every stand in the den, one after another, at about the pace of
   * someone clicking them. A shop that doesn't answer gets one more try
   * after the others.
   */
  async scanDen ({ gap = SCAN_GAP } = {}) {
    const visit = this.visit
    if (!visit || !visit.owner) throw new Error('Go into a den with a My Shop first.')
    if (!visit.stands.length) throw new Error('This den has no My Shop stands.')
    if (visit.scan && !visit.scan.done) throw new Error('Already scanning.')
    const scan = { total: visit.stands.length, done: 0, current: null, stopped: false }
    visit.scan = scan
    const open = async (stand) => {
      if (scan.stopped || this.visit !== visit) return false
      if (!this._inVisitedDen()) { scan.stopped = true; throw new Error('You left the den, so the scan stopped.') }
      scan.current = stand.id
      try { await this.browseShop(stand.id); return true } catch (error) {
        if (/left that den/.test(error.message)) { scan.stopped = true; throw error }
        // Give a slow answer time to arrive (and be dropped) before the next
        // request, so it can't be mistaken for the next shop's answer.
        await this.wait(LATE_WINDOW)
        this.late.delete('dsi')
        return false
      } finally { scan.current = null }
    }
    try {
      let retry = []
      for (const stand of visit.stands) {
        if (scan.stopped) break
        if (await open(stand)) scan.done++
        else retry.push(stand)
        await this.wait(gap)
      }
      if (retry.length && !scan.stopped) {
        await this.wait(gap * 2) // a breather before trying the slow ones again
        const again = retry
        retry = []
        for (const stand of again) {
          if (scan.stopped) break
          if (await open(stand)) scan.done++
          else retry.push(stand)
          await this.wait(gap)
        }
      }
      const items = [...visit.shops.values()].reduce((n, s) => n + s.items.length, 0)
      return { shops: scan.done, failed: retry.length, items, stopped: scan.stopped && this.visit === visit }
    } finally {
      visit.scan = null
    }
  }

  stopScan () {
    if (this.visit && this.visit.scan) this.visit.scan.stopped = true
  }

  /** What the Shop Explorer window shows. */
  explorer () {
    const visit = this.visit
    if (!visit) return { owner: null, stands: [], here: false, scan: null }
    const scan = visit.scan
    return {
      owner: visit.owner,
      here: this._inVisitedDen(),
      at: visit.at,
      scan: scan ? { total: scan.total, done: scan.done, current: scan.current, stopping: scan.stopped } : null,
      stands: visit.stands.map((s, i) => {
        const shop = visit.shops.get(s.id)
        return { ...s, number: i + 1, checkedAt: shop ? shop.checkedAt : null, items: shop ? shop.items.map(it => ({ ...it })) : null }
      })
    }
  }

  /* ------------------------------------------------------- sales log */

  _recordSale (sale) {
    this.sales.unshift({ at: nowIso(), ...sale, shop: this.shopName(sale.shopId) })
    if (this.sales.length > MAX_SALES) this.sales.length = MAX_SALES
    try { this.storage.set('sales', this.sales) } catch (_) {}
  }

  clearSales () {
    const n = this.sales.length
    this.sales = []
    try { this.storage.set('sales', this.sales) } catch (_) {}
    return n
  }

  salesCsv () { return salesCsv(this.sales) }

  /** Everything the window shows. */
  snapshot () {
    return {
      ready: { clothing: this.haveClothing, den: this.haveDen, loggedIn: !!this._me(), room: !!this.dispatch.getState('room') },
      busy: !!this.busy,
      stands: this.stands(),
      templates: this.templates.map(t => ({ ...t, items: t.items.map(i => ({ ...i })) })),
      shops: [...this.shops].map(([id, s]) => ({ id, items: s.items.map(i => ({ ...i })), checkedAt: s.checkedAt })),
      activity: this.activity.slice(),
      sales: this.sales.slice(0, 150),
      salesCount: this.sales.length,
      salesTotals: summarizeSales(this.sales)
    }
  }

  dispose () {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }
}

const MAX_SALES = 1000
const DEFAULT_STAND = 3993 // the usual My Shop stand, if item names haven't loaded
const SCAN_GAP = 1200 // between shops when scanning a den, like someone clicking them
const RECYCLE_GAP = 350 // between recycle requests
const OUTFIT_GAP = 300 // after changing clothes, before changing colors
const EXPLORE_TIMEOUT = 5000 // how long to wait for one shop's answer while exploring
const LATE_WINDOW = 4000 // how long after giving up JR still expects (and drops) the late answer

/**
 * The My Shop stands in a den, from the "ds" message you get on entering it:
 * %xt%ds%<room>%<item count>%...  then one record per den item:
 *   <slot>%<item>%<placed>%<x>%<y>%<?>%<?>%null%...
 * Records are found by their "null" field, so items with extra fields
 * (mannequins) don't throw the rest off. Sorted left to right.
 */
function readDenStands (v, isStand) {
  const seen = new Set()
  const out = []
  for (let j = 14; j < v.length; j++) {
    if (v[j] !== 'null') continue
    const s = j - 7
    if (!/^\d+$/.test(String(v[s])) || !/^\d+$/.test(String(v[s + 1]))) continue
    const id = Number(v[s]); const defId = Number(v[s + 1])
    if (seen.has(id) || !isStand(defId)) continue
    seen.add(id)
    out.push({ id, defId, placed: String(v[s + 2]) === '1', x: Number(v[s + 3]) || 0, y: Number(v[s + 4]) || 0 })
  }
  return out.filter(s => s.placed).sort((a, b) => a.x - b.x || a.y - b.y)
}

// Fields per item in someone else's shop: clothing 6, den 10, pet 14.
const VISITOR_SIZE = { 2: 6, 0: 10, 1: 14 }

/**
 * The items in a "dsi" answer:
 * %xt%dsi%-1%<1 ok>%<count>%<version>%  then per item
 *   <currency>%<cost>%<kind>%<slot>%<item>%...  (clothing adds its color)
 */
function parseShopItems (v) {
  const count = int(v[5])
  const end = v.length - (v[v.length - 1] === '' ? 1 : 0)
  const walk = (sizeOf) => {
    const items = []
    let i = 7
    for (let n = 0; n < count && i + 4 < end; n++) {
      const kindCode = int(v[i + 2])
      const item = { kind: KIND_NAME[kindCode] || 'other', currency: int(v[i]) === 3 ? 3 : 0, cost: int(v[i + 1]), slot: int(v[i + 3]), defId: int(v[i + 4]) }
      const size = sizeOf(kindCode)
      if (item.kind === 'clothing' && size > 5) item.color = Number(v[i + 5])
      items.push(item)
      i += size
    }
    return { items, exact: items.length === count && i === end }
  }
  const visitor = walk(k => VISITOR_SIZE[k] || 6)
  if (visitor.exact) return visitor.items
  const short = walk(() => 5)
  return short.exact ? short.items : visitor.items
}

/**
 * Sales totals for today, the last 7 days and everything kept, in Diamonds
 * and Gems: { today: { 3: n, 0: n, count }, week: {...}, all: {...} }.
 */
function summarizeSales (sales, now = Date.now()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  const today = start.getTime()
  const week = now - 7 * 24 * 60 * 60 * 1000
  const empty = () => ({ 3: 0, 0: 0, count: 0 })
  const out = { today: empty(), week: empty(), all: empty() }
  for (const s of sales || []) {
    const t = Date.parse(s.at)
    const cur = s.currency === 3 ? 3 : 0
    const add = (b) => { b[cur] += Number(s.cost) || 0; b.count++ }
    add(out.all)
    if (t >= week) add(out.week)
    if (t >= today) add(out.today)
  }
  return out
}

/** The sales log as CSV, oldest first, for a spreadsheet. */
function salesCsv (sales) {
  const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const rows = [['Time', 'Item', 'Type', 'Price', 'Currency', 'Shop']]
  for (const s of [...(sales || [])].reverse()) rows.push([s.at, s.name, s.kind, s.cost, s.currency === 3 ? 'Diamonds' : 'Gems', s.shop])
  return rows.map(r => r.map(cell).join(',')).join('\n')
}

module.exports = { ShopService, KIND, parseUpdate, summarizeSales, salesCsv, readDenStands, parseShopItems }
