'use strict'

/**
 * Buying: Den Shop (in the switch-den screen), Animal Buyer (in the
 * switch-animal screen) and Pet Catalog (in your pets).
 */

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const num = (n) => Number(n || 0).toLocaleString('en-US')

/* -------------------------------------------------------------- den shop */

const denShop = {
  id: 'denshop',
  plugin: 'den-shop',
  buttons: [{ at: 'denswitch', label: 'More Dens' }],
  init (ctx) {
    const D = this.D = require(path.join(ctx.root, 'plugins', 'den-shop', 'dens.js'))
    this.dens = new Map(); this.diamondDens = new Map(); this.forSale = null; this.buying = null; this.loaded = null
    ctx.dispatch.onMessage({ type: 'aj', message: 'gl', callback: ({ message }) => { const ids = D.readDiamondList(message.value); if (ids) { this.forSale = ids; ctx.surfaces.refresh('denshop') } } })
    ctx.dispatch.onMessage({
      type: 'aj',
      message: 'db',
      callback: ({ message }) => {
        const r = D.readBuyReply(message.value)
        if (!r || !this.buying) return
        const tried = this.buying
        this.buying = null
        if (r.ok) ctx.surfaces.toast(`Bought ${tried.name}! ${num(r.balance)} ${tried.diamonds ? 'Diamonds' : 'Gems'} left.`, 'ok')
        else ctx.surfaces.toast(`The game said no to ${tried.name} in slot ${tried.slot}. Usually: ${D.refusalHints(tried).join(', or ')}.`, 'bad')
        ctx.surfaces.refresh('denshop')
      }
    })
  },
  _load (ctx) {
    if (this.loaded) return this.loaded
    const D = this.D
    const items = ctx.items
    this.loaded = (async () => {
      if (!items.deployVersion) await items.load()
      const [denPack, shopPack, strings] = await Promise.all([
        items.fetchPack(items.deployVersion, D.PACKS.dens),
        items.fetchPack(items.deployVersion, D.PACKS.diamondShop).catch(() => null),
        items.fetchPack(items.deployVersion, D.PACKS.strings)
      ])
      this.dens = D.readDens(denPack, strings)
      this.diamondDens = shopPack ? D.readDiamondDens(shopPack, this.dens) : new Map()
    })().catch(e => { this.loaded = null; throw e })
    return this.loaded
  },
  async opened (state, ctx) {
    await this._load(ctx)
    const room = ctx.dispatch.getState('room')
    if (room) ctx.dispatch.sendRemoteMessage(this.D.listRequest(room)).catch(() => {})
  },
  view (state, ctx) {
    const tab = state.tab || 'gems'
    const store = ctx.surfaces.store('den-shop')
    const slot = store.get('slot', 1)
    const rows = []
    if (!this.dens.size) {
      rows.push({ t: 'p', c: 'dim', text: 'Reading the den list from the game…' })
      return { title: 'Den Shop', rows }
    }
    rows.push({ t: 'num', id: 'slot', label: 'Den slot to buy into (must be empty)', v: slot, step: 1 })
    rows.push({ t: 'in', id: 'q', label: 'Search', v: state.q || '', go: 'Find' })
    const q = String(state.q || '').toLowerCase()
    let list
    if (tab === 'gems') {
      list = [...this.dens.values()].filter(d => d.gems > 0 && (state.all || d.forGems)).map(d => ({ id: d.id, diamonds: false, name: d.name, cost: d.gems, members: d.members, forGems: d.forGems }))
    } else {
      const ids = this.forSale || [...this.diamondDens.keys()]
      list = ids.map(id => { const e = this.diamondDens.get(id); const d = e && this.dens.get(e.denId); return e ? { id, diamonds: true, name: d ? d.name : `Diamond Shop item #${id}`, cost: e.diamonds, members: d ? d.members : false } : null }).filter(Boolean)
    }
    list = list.filter(r => !q || r.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name))
    if (tab === 'gems') rows.push({ t: 'tog', id: 'all', label: 'Show dens the game doesn’t sell now', v: !!state.all })
    if (!list.length) rows.push({ t: 'p', c: 'dim', text: 'No dens here.' })
    for (const r of list.slice(0, 80)) {
      const key = `${r.diamonds ? 'd' : 'g'}:${r.id}`
      rows.push({
        t: 'li',
        text: r.name,
        sub: [r.members ? 'members' : null, r.forGems === false ? 'not sold now' : null].filter(Boolean).join(' · ') || null,
        right: `${num(r.cost)} ${r.diamonds ? 'Diamonds' : 'Gems'}`,
        sel: state.confirm === key,
        btns: [{ id: 'buy', label: state.confirm === key ? 'Sure?' : 'Buy', style: state.confirm === key ? 'danger' : 'primary', v: key }]
      })
    }
    return { title: 'Den Shop', tabs: [{ id: 'gems', l: 'Gems' }, { id: 'diamonds', l: 'Diamonds' }], tab, rows, h: 320 }
  },
  async act (state, c, v, inputs, ctx) {
    const store = ctx.surfaces.store('den-shop')
    if (c !== 'buy') state.confirm = null
    if (c === 'slot') { store.set('slot', Math.max(1, Math.min(99, Number(v) || 1))); return }
    if (c === 'q') { state.q = v.trim(); return }
    if (c === 'all') { state.all = v === '1'; return }
    if (c === 'buy') {
      if (state.confirm !== v) { state.confirm = v; return }
      state.confirm = null
      const [kind, idText] = v.split(':')
      const id = Number(idText)
      const diamonds = kind === 'd'
      let name, cost
      if (diamonds) { const e = this.diamondDens.get(id); const d = e && this.dens.get(e.denId); name = d ? d.name : `Diamond den #${id}`; cost = e && e.diamonds } else { const d = this.dens.get(id); name = d ? d.name : `Den #${id}`; cost = d && d.gems }
      const slot = store.get('slot', 1)
      const packet = this.D.buyPacket({ room: ctx.dispatch.getState('room'), id, slot, diamonds })
      this.buying = { id, name, diamonds, slot, cost, members: false }
      await ctx.dispatch.sendRemoteMessage(packet)
      ctx.surfaces.toast(`Buying ${name}…`)
      setTimeout(() => { if (this.buying && this.buying.id === id) { this.buying = null; ctx.surfaces.toast('No answer from the game. Check your dens.', 'warn') } }, 8000)
    }
  }
}

/* --------------------------------------------- animal buyer and pet catalog */

/** The animal list from the Animal Buyer plugin's own file. */
function loadAnimals (root) {
  const text = fs.readFileSync(path.join(root, 'plugins', 'animals', 'index.js'), 'utf8')
  const start = text.indexOf('const ANIMALS = [')
  if (start < 0) return []
  let depth = 0
  let i = text.indexOf('[', start)
  const from = i
  for (; i < text.length; i++) {
    if (text[i] === '[') depth++
    else if (text[i] === ']') { depth--; if (!depth) break }
  }
  return vm.runInNewContext(`(${text.slice(from, i + 1)})`, {}, { timeout: 1000 })
}

/** A buyer that repeats the game's own purchase request with another id. */
function catalogSurface ({ id, plugin, at, label, title, what, list, command, idOf, withId, help }) {
  return {
    id,
    plugin,
    buttons: [{ at, label }],
    init (ctx) {
      this.list = list(ctx)
      this.template = null
      ctx.dispatch.onMessage({ type: 'connection', message: command, callback: ({ message }) => { if (!message.fromPlugin && Array.isArray(message.value)) { const t = idOf(message.value); if (t != null) { this.template = message.value.slice(); ctx.surfaces.refresh(id) } } } })
      ctx.dispatch.onMessage({ type: 'aj', message: 'login', callback: () => { this.template = null } })
    },
    view (state, ctx) {
      const rows = []
      rows.push(this.template
        ? { t: 'p', c: 'ok', text: `Ready: JR saw the game buy ${what}, so it can buy any ${what} the same way.` }
        : { t: 'p', c: 'warn', text: help })
      rows.push({ t: 'in', id: 'q', label: 'Search', v: state.q || '', go: 'Find' })
      const q = String(state.q || '').toLowerCase()
      const shown = this.list.filter(a => !q || a.name.toLowerCase().includes(q))
      for (const a of shown.slice(0, 80)) {
        rows.push({
          t: 'li',
          text: a.name,
          sub: [`#${a.id}`, a.members ? 'members' : null, a.extra].filter(Boolean).join(' · '),
          right: a.cost ? `${num(a.cost)}` : null,
          rc: 'dim',
          btns: this.template ? [{ id: 'buy', label: state.confirm === a.id ? 'Sure?' : 'Buy', style: state.confirm === a.id ? 'danger' : 'primary', v: String(a.id) }] : []
        })
      }
      return { title, rows, h: 320 }
    },
    async act (state, c, v, inputs, ctx) {
      if (c !== 'buy') state.confirm = null
      if (c === 'q') { state.q = v.trim(); return }
      if (c === 'buy') {
        const n = Number(v)
        if (!this.template) throw new Error(help)
        if (state.confirm !== n) { state.confirm = n; return }
        state.confirm = null
        const parts = withId(this.template.slice(), n)
        const room = ctx.dispatch.getState('room')
        if (/^\d+$/.test(String(room || ''))) parts[4] = String(room)
        await ctx.dispatch.sendRemoteMessage(parts.join('%'))
        const a = this.list.find(x => x.id === n)
        ctx.surfaces.toast(`Asked to buy ${a ? a.name : `#${n}`}. Check the game for the result.`)
      }
    }
  }
}

const animals = catalogSurface({
  id: 'animals',
  plugin: 'animals',
  at: 'animals',
  label: 'Buy Animals',
  title: 'Animal Buyer',
  what: 'an animal',
  command: 'aa',
  help: 'Buy any animal the normal way once, so JR can copy how the game asks.',
  list: (ctx) => { try { return loadAnimals(ctx.root).map(a => ({ id: a.id, name: a.name, members: !!a.membersOnly, cost: a.cost })) } catch (_) { return [] } },
  idOf: (p) => (p[2] === 'o' && p[3] === 'aa' && /^\d+$/.test(String(p[8])) ? Number(p[8]) : null),
  withId: (p, n) => { p[8] = String(n); return p }
})

const pets = catalogSurface({
  id: 'pets',
  plugin: 'pet-catalog',
  at: 'pets',
  label: 'Pet Catalog',
  title: 'Pet Catalog',
  what: 'a pet',
  command: 'pc',
  help: 'Make one pet in the Pet Creator the normal way, so JR can copy how the game asks.',
  list: (ctx) => { try { return JSON.parse(fs.readFileSync(path.join(ctx.root, 'plugins', 'pet-catalog', 'pets.json'), 'utf8')).map(p => ({ id: p.id, name: p.name, members: !!p.isMember, cost: p.cost, extra: p.isEgg ? 'egg' : p.isReward ? 'reward' : null })) } catch (_) { return [] } },
  idOf: (p) => (p[2] === 'o' && p[3] === 'pc' && Number.isSafeInteger(Number(p[6])) ? (Number(p[6]) >>> 0) & 0xff : null),
  withId: (p, n) => { const u = Number(p[6]) >>> 0; const r = ((u & 0xffffff00) | (n & 0xff)) >>> 0; p[6] = String(r > 0x7fffffff ? r - 0x100000000 : r); return p }
})

module.exports = [denShop, animals, pets]
