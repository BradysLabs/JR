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
  constructor ({ dispatch, items, storage, wait, restockDelay = 3000 }) {
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
    this.busy = null
    this.activity = []
    this.timers = new Map()

    this.templates = this._load('templates', [])
    this.auto = this._load('auto', {}) // shop -> { templateId, when: 'sale'|'empty' }
    this.names = this._load('names', {}) // shop -> your own name for it (only shown in JR)

    const on = (type, message, fn) => dispatch.onMessage({ type, message, callback: ({ message: m }) => fn(m) })
    on('aj', 'il', (m) => this._onItemList(m.value))
    on('aj', 'di', (m) => this._onDenItems(m.value))
    on('aj', 'dsi', (m) => this._onReply('dsi', m))
    on('aj', 'dsu', (m) => this._onReply('dsu', m))
    on('aj', 'dsb', (m) => this._onBuy(m.value))
    on('aj', 'login', () => this._reset())
    // The game's own shop requests, so their replies still reach the game.
    on('connection', 'dsi', (m) => {
      const v = m.value || []
      this.pending.push({ cmd: 'dsi', from: 'game', owner: String(v[5] || '').toLowerCase(), shopId: int(v[6]) })
    })
    on('connection', 'dsu', (m) => this.pending.push({ cmd: 'dsu', from: 'game', change: parseUpdate(m.value) }))
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
      for (let n = 0; n < count && i + 4 < v.length; n++, i += 5) {
        const defId = int(v[i]); const invIdx = int(v[i + 1])
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
    } else if (code === '2' && this.haveClothing) {
      const color = Number(v[8]) >>> 0
      const added = Math.max(0, int(v[9]) || 0)
      const removed = Math.max(0, int(v[10]) || 0)
      let i = 11
      for (let n = 0; n < added && i + 1 < v.length; n++, i += 2) {
        const invIdx = int(v[i]); const defId = int(v[i + 1])
        if (invIdx >= 0 && defId > 0) this.clothing.set(invIdx, { defId, color, equipped: false, shop: 0 })
      }
      for (let n = 0; n < removed && i < v.length; n++, i++) this.clothing.delete(int(v[i]))
    }
  }

  _onDenItems (v) {
    if (!Array.isArray(v)) return
    const count = Math.max(0, Math.min(20000, int(v[5]) || 0))
    const next = new Map()
    let i = 7
    for (let n = 0; n < count && i + 8 < v.length; n++) {
      const invIdx = int(v[i]); const defId = int(v[i + 1])
      const placed = int(v[i + 2]) || 0
      const version = int(v[i + 3]) || 0
      i += 8
      const def = this.items.getDenItem && this.items.getDenItem(defId)
      if (def && def.specialType === MANNEQUIN) i += 10
      const shop = int(v[i]) || 0
      i += 1
      if (invIdx >= 0 && defId > 0) next.set(invIdx, { defId, version, placed, shop, stand: !!(def && def.specialType === SHOP_STAND) })
    }
    this.den = next
    this.haveDen = true
  }

  /** Your My Shop stands, from your den items. */
  stands () {
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

  _onReply (cmd, message) {
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

  _ask (cmd, args) {
    const room = this.dispatch.getState('room')
    if (!room) return Promise.reject(new Error('Join a room in Animal Jam first.'))
    const text = `%xt%o%${cmd}%${room}%${args.join('%')}%`
    return new Promise((resolve, reject) => {
      const entry = { cmd, from: 'jr', resolve: null }
      const timer = setTimeout(() => { entry.resolve = null; reject(new Error('Animal Jam didn’t answer. Try again in a moment.')) }, REPLY_TIMEOUT)
      entry.resolve = (value) => { clearTimeout(timer); resolve(value) }
      this.pending.push(entry)
      Promise.resolve(this.dispatch.sendRemoteMessage(text)).catch((error) => {
        clearTimeout(timer)
        const k = this.pending.indexOf(entry)
        if (k !== -1) this.pending.splice(k, 1)
        reject(error)
      })
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
    this._note(`Sold: ${kind === 'pet' ? 'a pet' : this.itemName(kind, defId)} for ${int(v[8])} ${int(v[7]) === 3 ? 'Diamonds' : 'Gems'}.`)

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

  /** Everything the window shows. */
  snapshot () {
    return {
      ready: { clothing: this.haveClothing, den: this.haveDen, loggedIn: !!this._me(), room: !!this.dispatch.getState('room') },
      busy: !!this.busy,
      stands: this.stands(),
      templates: this.templates.map(t => ({ ...t, items: t.items.map(i => ({ ...i })) })),
      shops: [...this.shops].map(([id, s]) => ({ id, items: s.items.map(i => ({ ...i })), checkedAt: s.checkedAt })),
      activity: this.activity.slice()
    }
  }

  dispose () {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }
}

module.exports = { ShopService, KIND, parseUpdate }
