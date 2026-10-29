'use strict'

/**
 * Shops: My Shop Templates and Restocker (in your own My Shop), Shop Explorer
 * (in other players' shops), Recycle Tool (in the recycle screen) and Bulk
 * Buy (in the game's stores).
 */

const path = require('path')
const { every } = require('./timers')

const num = (n) => Number(n || 0).toLocaleString('en-US')
const money = (cost, currency) => `${num(cost)} ${Number(currency) === 3 ? 'Diamonds' : 'Gems'}`
const NEED_RESTOCKER = 'Turn on My Shop Restocker in JR’s Plugins. It keeps track of your shops.'

/* ------------------------------------------------------------- my shop */

const myShop = {
  id: 'myshop',
  plugin: 'shop-templates',
  buttons: [{ at: 'myshop', label: 'Shop Tools' }],
  init (ctx) {
    // Keep the window current while it's open (refills, sales).
    every(() => ctx.surfaces.refresh('myshop'), 3000)
  },
  view (state, ctx) {
    const api = ctx.shopApi()
    if (!api) return { title: 'My Shop Tools', rows: [{ t: 'p', c: 'warn', text: NEED_RESTOCKER }] }
    const snap = api.snapshot()
    const tab = state.tab || 'templates'
    const shopId = Number(state.ctx && state.ctx.shopId)
    const stand = snap.stands.find(s => s.id === shopId) || snap.stands[0]
    const rows = []
    if (tab === 'templates') {
      if (!stand) {
        rows.push({ t: 'p', c: 'dim', text: 'Go to your den once so JR can see your shops.' })
      } else {
        rows.push({ t: 'kv', k: 'Shop', v: stand.name })
        if (stand.count != null) rows.push({ t: 'kv', k: 'Items in it', v: num(stand.count) })
        rows.push({ t: 'in', id: 'rename', label: 'Rename this shop (only you see the name)', v: stand.named ? stand.name : '', go: 'Rename', max: 30 })
        rows.push({ t: 'in', id: 'save', label: 'Save what’s in this shop as a template', v: '', go: 'Save', max: 40 })
      }
      rows.push({ t: 'sep' })
      rows.push({ t: 'h', text: 'Templates' })
      if (!snap.templates.length) rows.push({ t: 'p', c: 'dim', text: 'No templates yet. Fill your shop, then save it above.' })
      for (const tpl of snap.templates) {
        const auto = stand && stand.auto && stand.auto.templateId === tpl.id
        rows.push({
          t: 'li',
          text: tpl.name,
          sub: `${tpl.items.length} item${tpl.items.length === 1 ? '' : 's'}${auto ? ' · refills when empty' : ''}`,
          sel: auto,
          btns: [
            { id: 'refill', label: 'Refill', style: 'primary', v: tpl.id },
            { id: 'auto', label: auto ? 'Auto: on' : 'Auto: off', style: auto ? 'on' : 'normal', v: tpl.id },
            { id: 'del', label: state.confirm === tpl.id ? 'Sure?' : 'Delete', style: 'danger', v: tpl.id }
          ]
        })
      }
      if (snap.busy) rows.push({ t: 'p', c: 'warn', text: 'Working…' })
      const recent = snap.activity.slice(0, 4)
      if (recent.length) {
        rows.push({ t: 'sep' })
        for (const a of recent) rows.push({ t: 'p', c: a.kind === 'bad' ? 'bad' : a.kind === 'good' ? 'ok' : 'dim', text: a.text })
      }
    } else {
      const t = snap.salesTotals
      const both = (b) => [b[0] ? `${num(b[0])} Gems` : null, b[3] ? `${num(b[3])} Diamonds` : null].filter(Boolean).join(' · ') || '—'
      rows.push({ t: 'kv', k: `Today (${t.today.count})`, v: both(t.today), c: 'ok' })
      rows.push({ t: 'kv', k: `This week (${t.week.count})`, v: both(t.week) })
      rows.push({ t: 'kv', k: `All (${t.all.count})`, v: both(t.all) })
      rows.push({ t: 'sep' })
      if (!snap.sales.length) rows.push({ t: 'p', c: 'dim', text: 'No sales yet. They show here while JR is running.' })
      for (const s of snap.sales.slice(0, 40)) {
        rows.push({ t: 'li', text: s.name || 'An item', sub: `${new Date(s.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${s.shop ? ` · ${s.shop}` : ''}`, right: money(s.cost, s.currency) })
      }
      if (snap.sales.length) rows.push({ t: 'btn', id: 'clearsales', label: state.confirmClear ? 'Press again to clear the list' : 'Clear sales list', style: 'danger' })
    }
    return { title: 'My Shop Tools', tabs: [{ id: 'templates', l: 'Templates' }, { id: 'sales', l: 'Sales' }], tab, rows, h: 330 }
  },
  async act (state, c, v, inputs, ctx) {
    const api = ctx.shopApi()
    if (!api) throw new Error(NEED_RESTOCKER)
    const snap = api.snapshot()
    const shopId = Number(state.ctx && state.ctx.shopId)
    const stand = snap.stands.find(s => s.id === shopId) || snap.stands[0]
    if (c !== 'del') state.confirm = null
    if (c !== 'clearsales') state.confirmClear = false
    if (c === 'clearsales') {
      if (!state.confirmClear) { state.confirmClear = true; return }
      state.confirmClear = false
      api.clearSales()
      return
    }
    if (!stand) throw new Error('Go to your den once so JR can see your shops.')
    if (c === 'rename') { api.renameShop(stand.id, v.trim()); return }
    if (c === 'save') {
      ctx.surfaces.toast('Reading your shop…')
      const tpl = await api.saveTemplate(stand.id, v.trim())
      ctx.surfaces.toast(`Saved “${tpl.name}”.`, 'ok')
      return
    }
    if (c === 'del') {
      if (state.confirm !== v) { state.confirm = v; return }
      state.confirm = null
      api.deleteTemplate(v)
      return
    }
    if (c === 'auto') {
      const on = stand.auto && stand.auto.templateId === v
      api.setAuto(stand.id, on ? '' : v, 'empty')
      ctx.surfaces.toast(on ? 'Automatic refills are off.' : 'Your shop will refill when it’s empty.', 'ok')
      return
    }
    if (c === 'refill') {
      ctx.surfaces.toast('Refilling your shop…')
      const r = await api.restock(stand.id, v)
      ctx.surfaces.toast(r.added ? `Added ${r.added} item${r.added === 1 ? '' : 's'}. Close and reopen your shop to see them.${r.missing && r.missing.length ? ` Missing: ${r.missing.length}.` : ''}`
        : r.full ? 'Your shop already matches that template.' : 'JR couldn’t refill the shop. Check JR’s Logs.', r.added ? 'ok' : 'warn')
    }
  }
}

/* --------------------------------------------------------- shop explorer */

const explorer = {
  id: 'explorer',
  plugin: 'shop-explorer',
  buttons: [{ at: 'shopview', label: 'All Shops Here' }],
  init (ctx) { every(() => ctx.surfaces.refresh('explorer'), 2000) },
  view (state, ctx) {
    const api = ctx.shopApi()
    if (!api) return { title: 'Shop Explorer', rows: [{ t: 'p', c: 'warn', text: NEED_RESTOCKER }] }
    const ex = api.explorer()
    const pricer = ctx.pricer()
    const rows = []
    if (!ex.owner || !ex.here) {
      rows.push({ t: 'p', c: 'dim', text: 'Go into a den that has My Shops, then press Scan.' })
      return { title: 'Shop Explorer', rows }
    }
    rows.push({ t: 'kv', k: 'Den', v: `${ctx.mask(ex.owner)} · ${ex.stands.length} shop${ex.stands.length === 1 ? '' : 's'}` })
    if (ex.scan) {
      rows.push({ t: 'p', c: 'warn', text: `Checking shop ${Math.min(ex.scan.done + 1, ex.scan.total)} of ${ex.scan.total}…` })
      rows.push({ t: 'btn', id: 'stop', label: 'Stop', style: 'danger' })
    } else {
      rows.push({ t: 'btn', id: 'scan', label: ex.stands.some(s => s.items) ? 'Scan again' : 'Scan every shop here', style: 'primary' })
    }
    rows.push({ t: 'chips', id: 'sort', v: state.sort || 'deal', opts: [{ v: 'deal', l: 'Best deals' }, { v: 'shop', l: 'By shop' }, { v: 'cheap', l: 'Cheapest' }] })
    const all = []
    for (const s of ex.stands) {
      for (const it of s.items || []) {
        if (it.kind === 'pet') continue
        const v = pricer.value({ kind: it.kind, id: it.defId, color: it.color == null ? null : Number(it.color) >>> 0 })
        const worth = v.diamonds ? (v.diamonds.min + v.diamonds.max) / 2 : null
        const deal = worth && Number(it.currency) === 3 && it.cost ? worth / it.cost : null
        all.push({ ...it, shop: s.number, name: v.name || it.name || `Item #${it.defId}`, colorName: v.color, worth: v.diamonds, deal })
      }
    }
    const sort = state.sort || 'deal'
    all.sort(sort === 'shop' ? (a, b) => a.shop - b.shop : sort === 'cheap' ? (a, b) => a.cost - b.cost : (a, b) => (b.deal || 0) - (a.deal || 0) || a.cost - b.cost)
    if (!all.length) rows.push({ t: 'p', c: 'dim', text: ex.stands.some(s => s.items) ? 'Nothing for sale here.' : 'Press Scan to see what’s for sale.' })
    for (const it of all.slice(0, 80)) {
      rows.push({
        t: 'li',
        text: it.name,
        sub: [it.colorName, `shop ${it.shop}`, it.worth ? `worth ${pricer.format(it.worth, { bl: false }).replace('≈ ', '')}` : null].filter(Boolean).join(' · '),
        right: money(it.cost, it.currency),
        rc: it.deal == null ? 'dim' : it.deal >= 1.2 ? 'ok' : it.deal < 0.8 ? 'bad' : 'warn'
      })
    }
    return { title: 'Shop Explorer', rows, foot: 'Green prices are below the Item Worth Wiki value.', h: 330 }
  },
  async act (state, c, v, inputs, ctx) {
    const api = ctx.shopApi()
    if (!api) throw new Error(NEED_RESTOCKER)
    if (c === 'sort') { state.sort = v; return }
    if (c === 'stop') { api.stopScan(); return }
    if (c === 'scan') {
      api.scanDen().then(r => {
        ctx.surfaces.toast(`Scanned ${r.shops} shop${r.shops === 1 ? '' : 's'}: ${r.items} item${r.items === 1 ? '' : 's'} for sale.`, 'ok')
        ctx.surfaces.refresh('explorer')
      }).catch(e => ctx.surfaces.toast(e.message, 'bad'))
    }
  }
}

/* ---------------------------------------------------------- recycle tool */

const recycleTool = {
  id: 'recycle',
  plugin: 'recycle-tool',
  buttons: [{ at: 'recycle', label: 'Presets' }],
  _presets (ctx) {
    const store = ctx.surfaces.store('recycle-tool')
    let presets = store.get('presets', [])
    if (!Array.isArray(presets)) presets = []
    let current = store.get('current', null)
    if (!presets.length) { presets = [{ id: 'p1', name: 'My preset', items: [] }]; current = 'p1' }
    const preset = presets.find(p => p.id === current) || presets[0]
    return { store, presets, preset, save: () => { store.set('presets', presets); store.set('current', preset.id) } }
  },
  view (state, ctx) {
    const api = ctx.shopApi()
    if (!api) return { title: 'Recycle Presets', rows: [{ t: 'p', c: 'warn', text: NEED_RESTOCKER }] }
    const { presets, preset } = this._presets(ctx)
    const plan = api.planRecycle(preset.items)
    const rs = api.recycleSnapshot()
    const rows = []
    rows.push({ t: 'chips', id: 'preset', label: 'Preset', v: preset.id, opts: presets.map(p => ({ v: p.id, l: `${p.name} (${p.items.length})` })) })
    rows.push({ t: 'in', id: 'newpreset', label: 'New preset', v: '', go: 'Add', max: 40 })
    rows.push({ t: 'sep' })
    if (!preset.items.length) rows.push({ t: 'p', c: 'dim', text: 'This preset is empty. Add items you own below.' })
    const by = new Map(plan.byEntry.map(e => [`${e.kind}:${e.defId}`, e]))
    preset.items.forEach((it, i) => {
      const e = by.get(`${it.kind}:${it.defId}`) || { owned: 0, safe: 0, recycle: 0 }
      const name = (e.name && !/#\d+$/.test(e.name)) ? e.name : (ctx.items.name(it.defId, it.kind) || `Item #${it.defId}`)
      rows.push({
        t: 'li',
        text: name,
        sub: `have ${e.owned}${e.owned - e.safe ? ` (${e.owned - e.safe} worn/in shop, never recycled)` : ''} · keep ${it.keep || 0} · recycles ${e.recycle}`,
        btns: [{ id: 'keepless', label: '-', v: String(i) }, { id: 'keepmore', label: '+', v: String(i) }, { id: 'remove', label: 'X', style: 'danger', v: String(i) }]
      })
    })
    rows.push({ t: 'sep' })
    if (rs.running) {
      rows.push({ t: 'p', c: 'warn', text: `Recycling ${rs.running.done} of ${rs.running.total}…` })
      rows.push({ t: 'btn', id: 'stop', label: 'Stop', style: 'danger' })
    } else {
      rows.push({ t: 'btn', id: 'run', label: state.confirm ? `Press again to recycle ${plan.recycle.length} item${plan.recycle.length === 1 ? '' : 's'}` : `Recycle ${plan.recycle.length} item${plan.recycle.length === 1 ? '' : 's'} now`, style: state.confirm ? 'danger' : 'primary' })
    }
    rows.push({ t: 'tog', id: 'auto', label: 'Recycle these as they arrive', sub: rs.auto ? `On for “${rs.auto.name}”` : 'For farming: matching items are recycled as soon as you get them.', v: !!rs.auto })
    rows.push({ t: 'sep' })
    rows.push({ t: 'in', id: 'q', label: 'Add something you own', v: state.q || '', go: 'Find' })
    const q = String(state.q || '').toLowerCase().trim()
    if (q) {
      const inPreset = new Set(preset.items.map(it => `${it.kind}:${it.defId}`))
      const inv = api.inventory()
      const hits = inv.items.filter(x => !inPreset.has(`${x.kind}:${x.defId}`) && String(x.name).toLowerCase().includes(q)).slice(0, 20)
      if (!hits.length) rows.push({ t: 'p', c: 'dim', text: 'Nothing you own matches.' })
      for (const x of hits) rows.push({ t: 'li', text: x.name, sub: `${x.kind === 'den' ? 'den item' : 'clothing'} · ${x.owned} owned`, btns: [{ id: 'add', label: 'Add', style: 'primary', v: `${x.kind}:${x.defId}` }] })
    }
    if (rs.log.length) {
      rows.push({ t: 'sep' })
      for (const l of rs.log.slice(0, 3)) rows.push({ t: 'p', c: 'dim', text: `${l.label || 'Recycled'}: ${l.count} item${l.count === 1 ? '' : 's'}${l.what ? ` (${l.what})` : ''}` })
    }
    return { title: 'Recycle Presets', rows, h: 330 }
  },
  async act (state, c, v, inputs, ctx) {
    const api = ctx.shopApi()
    if (!api) throw new Error(NEED_RESTOCKER)
    const p = this._presets(ctx)
    if (c !== 'run') state.confirm = false
    if (c === 'preset') { p.store.set('current', v); return }
    if (c === 'newpreset') {
      const id = `p${Date.now().toString(36)}`
      p.presets.push({ id, name: (v.trim() || `Preset ${p.presets.length + 1}`).slice(0, 40), items: [] })
      p.store.set('presets', p.presets); p.store.set('current', id)
      return
    }
    if (c === 'q') { state.q = v; return }
    if (c === 'add') {
      const [kind, defId] = v.split(':')
      p.preset.items.push({ kind, defId: Number(defId), keep: 0 })
      p.save()
      return
    }
    if (c === 'keepless' || c === 'keepmore' || c === 'remove') {
      const it = p.preset.items[Number(v)]
      if (!it) return
      if (c === 'remove') p.preset.items.splice(Number(v), 1)
      else it.keep = Math.max(0, (Number(it.keep) || 0) + (c === 'keepmore' ? 1 : -1))
      p.save()
      return
    }
    if (c === 'stop') { api.stopRecycle(); return }
    if (c === 'auto') {
      const on = !!api.recycleSnapshot().auto
      if (!on && !p.preset.items.length) throw new Error('Add items to the preset first.')
      api.setAutoRecycle(on ? null : { name: p.preset.name, entries: p.preset.items })
      return
    }
    if (c === 'run') {
      const plan = api.planRecycle(p.preset.items)
      if (!plan.recycle.length) throw new Error('Nothing in this preset can be recycled right now.')
      if (!state.confirm) { state.confirm = true; return }
      state.confirm = false
      api.recycleNow(p.preset.items, p.preset.name)
        .then(r => ctx.surfaces.toast(r.recycled ? `Recycled ${r.recycled} item${r.recycled === 1 ? '' : 's'}.` : 'Nothing to recycle.', 'ok'))
        .catch(e => ctx.surfaces.toast(e.message, 'bad'))
        .then(() => ctx.surfaces.refresh('recycle'))
    }
  }
}

/* -------------------------------------------------------------- bulk buy */

const bulkBuy = {
  id: 'bulkbuy',
  plugin: 'bulk-buy',
  buttons: [{ at: 'shop', label: 'Buy More' }],
  init (ctx) {
    const { BulkBuyer } = require(path.join(ctx.root, 'plugins', 'bulk-buy', 'bulk.js'))
    this.buyer = new BulkBuyer({ dispatch: ctx.dispatch, onChange: () => ctx.surfaces.refresh('bulkbuy') })
  },
  view (state, ctx) {
    const b = this.buyer
    const rows = []
    const p = b.last
    if (!p) {
      rows.push({ t: 'p', c: 'dim', text: 'Buy one of something in this store first. Then JR can buy more of exactly that item and color.' })
    } else {
      rows.push({ t: 'kv', k: 'Last bought', v: ctx.items.name(p.defId, p.kind) || `Item #${p.defId}` })
      if (b.run) {
        rows.push({ t: 'p', c: 'warn', text: `Bought ${b.run.done} of ${b.run.total}…` })
        rows.push({ t: 'btn', id: 'stop', label: 'Stop', style: 'danger' })
      } else {
        rows.push({ t: 'num', id: 'count', label: 'How many more', v: state.count || 5, step: 1 })
        rows.push({ t: 'row', items: [5, 10, 25, 50].map(n => ({ id: 'count', label: String(n), v: String(n) })) })
        rows.push({ t: 'btn', id: 'buy', label: `Buy ${state.count || 5} more`, style: 'primary' })
      }
    }
    if (state.result) rows.push({ t: 'p', c: state.result.c, text: state.result.text })
    return { title: 'Buy More', rows }
  },
  async act (state, c, v, inputs, ctx) {
    if (c === 'count') { state.count = Math.max(1, Math.min(100, Number(v) || 1)); return }
    if (c === 'stop') { this.buyer.stop(); return }
    if (c === 'buy') {
      state.result = null
      this.buyer.buy(state.count || 5)
        .then(r => {
          state.result = r.refused
            ? { c: 'warn', text: `Bought ${r.done}. Then the store said no (usually not enough Gems or Diamonds).` }
            : { c: 'ok', text: `Bought ${r.done}.${r.balance != null ? ` Balance: ${num(r.balance)}.` : ''} Reopen your inventory to see them.` }
        })
        .catch(e => { state.result = { c: 'bad', text: e.message } })
        .then(() => ctx.surfaces.refresh('bulkbuy'))
    }
  }
}

module.exports = [myShop, explorer, recycleTool, bulkBuy]
