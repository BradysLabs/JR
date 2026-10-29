'use strict'

/**
 * In the game's Edit Animal screen (and the den editor and trade window):
 * Inventory Worth, Outfits, Item Previewer and Glow Picker.
 */

const fs = require('fs')
const path = require('path')

const num = (n) => Number(n || 0).toLocaleString('en-US')
const mid = (r) => (r ? (r.min + r.max) / 2 : -1)

/* ------------------------------------------------------- inventory worth */

/** Your inventory: live from the Inventory Reader, or its last saved copy. */
function inventoryOf (ctx) {
  const live = ctx.dispatch.getState('jrInventory')
  if (live && typeof live.get === 'function') return live.get()
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(ctx.profileDir, 'plugin-data', 'inventory-worth-capture', 'inventory.json'), 'utf8'))
    return { clothing: saved.items || [], den: saved.den || [], receivedAt: saved.receivedAt }
  } catch (_) { return { clothing: [], den: [], receivedAt: null } }
}

function valued (ctx, inv) {
  const pricer = ctx.pricer()
  const groups = new Map()
  const add = (kind, defId, color) => {
    const key = `${kind}:${defId}:${color == null ? '' : color}`
    const g = groups.get(key)
    if (g) g.count++; else groups.set(key, { kind, id: defId, color, count: 1 })
  }
  for (const c of inv.clothing || []) add('clothing', c.defId, Number(c.color) >>> 0)
  for (const d of inv.den || []) add('den', d.defId, null)
  const out = []
  for (const g of groups.values()) {
    const v = pricer.value(g)
    const each = v.diamonds
    out.push({ ...g, name: v.name || `${g.kind === 'den' ? 'Den item' : 'Item'} #${g.id}`, colorName: v.color, each, status: v.status, store: v.store, total: each ? { min: each.min * g.count, max: each.max * g.count } : null })
  }
  return out
}

function worthSurface (id, kinds, buttons, title) {
  return {
    id,
    plugin: 'inventory-worth',
    buttons,
    view (state, ctx) {
      const pricer = ctx.pricer()
      const inv = inventoryOf(ctx)
      const all = valued(ctx, inv).filter(r => kinds.includes(r.kind))
      const tab = state.tab || 'top'
      const rows = []
      if (!all.length) {
        rows.push({ t: 'p', c: 'dim', text: kinds.length === 1 && kinds[0] === 'den'
          ? 'JR hasn’t seen your den items yet. Go to your den once.'
          : 'JR hasn’t seen your inventory yet. Open your clothing in Animal Jam, and visit your den for den items.' })
        return { title, rows }
      }
      const vals = all.filter(r => r.total)
      const sum = vals.reduce((s, r) => ({ min: s.min + r.total.min, max: s.max + r.total.max }), { min: 0, max: 0 })
      const copies = all.reduce((n, r) => n + r.count, 0)
      rows.push({ t: 'kv', k: 'Total worth', v: vals.length ? pricer.format(sum) : 'No wiki values yet', c: 'ok' })
      rows.push({ t: 'kv', k: 'Valued', v: `${num(vals.reduce((n, r) => n + r.count, 0))} of ${num(copies)} items` })
      rows.push({ t: 'in', id: 'q', label: 'Search', v: state.q || '', go: 'Find' })
      const q = String(state.q || '').toLowerCase()
      let shown = all.filter(r => !q || `${r.name} ${r.colorName || ''}`.toLowerCase().includes(q))
      if (tab === 'top') shown = shown.filter(r => r.total).sort((a, b) => mid(b.total) - mid(a.total))
      else if (tab === 'all') shown = shown.sort((a, b) => mid(b.total) - mid(a.total) || a.name.localeCompare(b.name))
      else shown = shown.filter(r => !r.total).sort((a, b) => a.name.localeCompare(b.name))
      const LIMIT = 60
      for (const r of shown.slice(0, LIMIT)) {
        const right = r.total ? pricer.format(r.total, { bl: false }).replace('≈ ', '')
          : r.store && r.status !== 'unknown' ? `${num(r.store.cost)} ${r.store.currency}` : r.status === 'unclear' ? 'several values' : '—'
        rows.push({
          t: 'li',
          text: `${r.name}${r.count > 1 ? ` ×${r.count}` : ''}`,
          sub: [r.colorName, r.count > 1 && r.each ? `${pricer.format(r.each, { bl: false }).replace('≈ ', '')} each` : null, r.kind === 'den' ? 'den item' : null].filter(Boolean).join(' · ') || null,
          right,
          rc: r.total ? 'ok' : 'dim'
        })
      }
      if (shown.length > LIMIT) rows.push({ t: 'p', c: 'dim', text: `Showing ${LIMIT} of ${num(shown.length)}. Search to find the rest.` })
      if (!shown.length) rows.push({ t: 'p', c: 'dim', text: 'Nothing here.' })
      const when = inv.receivedAt ? new Date(inv.receivedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
      return {
        title,
        sub: `${num((inv.clothing || []).length)} clothing · ${num((inv.den || []).length)} den items${when ? ` · updated ${when}` : ''}`,
        tabs: [{ id: 'top', l: 'Most valuable' }, { id: 'all', l: 'Everything' }, { id: 'none', l: 'No value' }],
        tab,
        rows,
        foot: 'Values from the Animal Jam Item Worth Wiki.',
        h: 330
      }
    },
    act (state, c, v) {
      if (c === 'q') state.q = v.trim()
    }
  }
}

/* ------------------------------------------------------------- trading */

const tradeWorth = {
  id: 'tradeworth',
  plugin: 'inventory-worth',
  buttons: [{ at: 'trade', label: 'Worth' }],
  init (ctx) {
    ctx.dispatch.on('state', (key) => { if (key === 'jrTrade') ctx.surfaces.refresh('tradeworth') })
  },
  view (state, ctx) {
    const t = ctx.dispatch.getState('jrTrade')
    const pricer = ctx.pricer()
    const rows = []
    const side = (label, list) => {
      rows.push({ t: 'h', text: label })
      if (!list || !list.length) { rows.push({ t: 'p', c: 'dim', text: 'Nothing yet.' }); return { min: 0, max: 0 } }
      let sum = { min: 0, max: 0 }
      for (const it of list) {
        if (it.kind === 'pet' || it.defId == null) { rows.push({ t: 'li', text: it.kind === 'pet' ? 'A pet' : 'An item', right: '—', rc: 'dim' }); continue }
        const v = pricer.value({ kind: it.kind, id: it.defId, color: it.color == null ? null : Number(it.color) >>> 0 })
        if (v.diamonds) sum = { min: sum.min + v.diamonds.min, max: sum.max + v.diamonds.max }
        rows.push({ t: 'li', text: v.name || `Item #${it.defId}`, sub: v.color || null, right: v.diamonds ? pricer.format(v.diamonds, { bl: false }).replace('≈ ', '') : '—', rc: v.diamonds ? 'ok' : 'dim' })
      }
      rows.push({ t: 'kv', k: 'Total', v: sum.max ? pricer.format(sum) : '—', c: 'ok' })
      return sum
    }
    if (!t || !t.active) {
      rows.push({ t: 'p', c: 'dim', text: 'Values show here during a trade.' })
    } else {
      const mine = side('You give', t.mine)
      const theirs = side(`${ctx.mask(t.user || 'They')} gives`, t.theirs)
      if (mine.max || theirs.max) {
        const diff = mid(theirs) - mid(mine)
        rows.push({ t: 'sep' })
        rows.push({ t: 'p', b: true, c: diff >= 0 ? 'ok' : 'warn', text: diff >= 0 ? `You get about ${num(Math.round(diff))} Diamonds more than you give.` : `You give about ${num(Math.round(-diff))} Diamonds more than you get.` })
      }
    }
    return { title: 'Trade Worth', rows, foot: 'Values from the Animal Jam Item Worth Wiki. Estimates, not guarantees.' }
  }
}

/* ---------------------------------------------------------------- outfits */

const outfits = {
  id: 'outfits',
  plugin: 'outfits',
  buttons: [{ at: 'avatarinv', label: 'Save Outfit', icon: 'outfit' }],
  view (state, ctx) {
    const list = ctx.surfaces.store('outfits').get('outfits', [])
    const api = ctx.shopApi()
    const now = api && api.currentOutfit ? api.currentOutfit() : null
    const rows = []
    if (!api) rows.push({ t: 'p', c: 'warn', text: 'Turn on My Shop Restocker in JR’s Plugins. It keeps track of your clothes.' })
    else if (!now.ready) rows.push({ t: 'p', c: 'dim', text: 'Log in and JR will see what you’re wearing.' })
    else rows.push({ t: 'p', c: 'dim', text: `Wearing: ${now.clothing.length ? now.clothing.map(c => c.name).join(', ') : 'nothing'}` })
    rows.push({ t: 'in', id: 'name', label: 'Save what you’re wearing as', v: '', go: 'Save', max: 40 })
    rows.push({ t: 'sep' })
    if (!Array.isArray(list) || !list.length) rows.push({ t: 'p', c: 'dim', text: 'No outfits yet.' })
    else {
      list.forEach((o, i) => rows.push({
        t: 'li',
        text: o.name,
        sub: `${o.clothing.length} item${o.clothing.length === 1 ? '' : 's'}: ${o.clothing.map(c => c.name).join(', ')}`.slice(0, 140),
        btns: [{ id: 'wear', label: 'Wear', style: 'primary', v: String(i) }, { id: 'del', label: state.confirm === i ? 'Sure?' : 'Delete', style: 'danger', v: String(i) }]
      }))
    }
    return { title: 'Outfits', rows }
  },
  async act (state, c, v, inputs, ctx) {
    const store = ctx.surfaces.store('outfits')
    const list = store.get('outfits', [])
    const api = ctx.shopApi()
    if (c === 'name') {
      if (!api) throw new Error('Turn on My Shop Restocker in JR’s Plugins first.')
      const now = api.currentOutfit()
      if (!now.ready) throw new Error('Log in first.')
      const name = (v.trim() || `Outfit ${list.length + 1}`).slice(0, 40)
      const nameOf = (x) => x.name && !/#\d+$/.test(x.name) ? x.name : ((ctx.items.getClothing(x.defId) || {}).name || `Item #${x.defId}`)
      list.push({ id: Date.now().toString(36), name, clothing: now.clothing.map(x => ({ slot: x.slot, defId: x.defId, color: x.color, name: nameOf(x) })), savedAt: new Date().toISOString() })
      store.set('outfits', list)
      ctx.surfaces.toast(`Saved “${name}”.`, 'ok')
      return
    }
    const i = Number(v)
    const o = list[i]
    if (!o) return
    if (c === 'del') {
      if (state.confirm !== i) { state.confirm = i; return }
      state.confirm = null
      list.splice(i, 1)
      store.set('outfits', list)
      return
    }
    state.confirm = null
    if (c === 'wear') {
      if (!api) throw new Error('Turn on My Shop Restocker in JR’s Plugins first.')
      ctx.surfaces.toast(`Putting on ${o.name}…`)
      const r = await api.wearOutfit(o, { clothing: true, look: false })
      ctx.surfaces.toast(`${o.name}: ${r.putOn + r.tookOff ? 'done' : 'you’re already wearing it'}.${r.missing.length ? ` Missing: ${r.missing.join(', ')}.` : ''}`, r.missing.length ? 'warn' : 'ok')
    }
  }
}

/* ---------------------------------------------------------- item previewer */

// Preview items get made-up inventory slots from here up, so they never
// clash with real ones. Nothing about them is sent to Animal Jam.
const FAKE_SLOT_BASE = 900000

const tryOn = {
  id: 'tryon',
  plugin: 'item-previewer',
  buttons: [{ at: 'avatarinv', label: 'Try On', icon: 'tryon' }],
  init (ctx) {
    const d = ctx.dispatch
    const st = this.st = { me: null, previews: new Map(), next: FAKE_SLOT_BASE, lastOwnWear: 0, colors: [], pack: null }
    const myName = () => { const p = d.getState('player') || {}; return String(p.userName || p.username || '').toLowerCase() }
    st.toGame = (entries) => {
      if (!st.me) throw new Error('Put on or take off any item once, so JR can find your animal.')
      const on = entries.filter(e => e.worn); const off = entries.filter(e => !e.worn)
      const f = ['', 'xt', 'il', -1, 3, 0, st.me.animal, st.me.username, 0, on.length, off.length]
      on.forEach(e => f.push(e.slot, e.id)); off.forEach(e => f.push(e.slot))
      d.sendConnectionMessage(f.join('%') + '%')
    }
    st.add = (e) => {
      if (!st.me) throw new Error('Put on or take off any item once, so JR can find your animal.')
      d.sendConnectionMessage(['', 'xt', 'il', -1, 2, 1, st.me.animal, st.me.username, e.colorValue, 1, 0, e.slot, e.id].join('%') + '%')
    }
    d.onMessage({
      type: 'aj',
      message: 'il',
      callback: ({ message }) => {
        const p = message.value
        if (!Array.isArray(p) || p.length < 10) return
        const u = String(p[7] || '').toLowerCase()
        if ((myName() && u === myName()) || Date.now() - st.lastOwnWear < 3000) {
          const fresh = !st.me
          st.me = { animal: p[6], username: p[7] }
          if (fresh) ctx.surfaces.refresh('tryon')
        }
      }
    })
    d.onMessage({
      type: 'connection',
      message: 'iu',
      callback: ({ message }) => {
        const parts = message.value
        const end = parts[parts.length - 1] === '' ? parts.length - 1 : parts.length
        const onN = parseInt(parts[5], 10) || 0; const offN = parseInt(parts[6], 10) || 0
        const putOn = parts.slice(7, 7 + onN).map(Number)
        const takenOff = parts.slice(7 + onN, Math.min(end, 7 + onN + offN)).map(Number)
        const isPreview = s => st.previews.has(s)
        if (!putOn.concat(takenOff).some(isPreview)) { st.lastOwnWear = Date.now(); return }
        const changed = []
        putOn.filter(isPreview).forEach(s => { const p = st.previews.get(s); p.worn = true; changed.push(p) })
        takenOff.filter(isPreview).forEach(s => { const p = st.previews.get(s); p.worn = false; changed.push(p) })
        try { st.toGame(changed) } catch (_) {}
        const realOn = putOn.filter(s => !isPreview(s)); const realOff = takenOff.filter(s => !isPreview(s))
        if (realOn.length || realOff.length) {
          message.value = [...parts.slice(0, 5), realOn.length, realOff.length, ...realOn, ...realOff, '']
          st.lastOwnWear = Date.now()
        } else {
          message.send = false
          d.sendConnectionMessage(`%xt%iu%${parts[4]}%1%`)
        }
        ctx.surfaces.refresh('tryon')
      }
    })
    // Changing rooms shows your real outfit again: put the previews back on.
    d.onMessage({
      type: 'aj',
      message: 'rj',
      callback: () => {
        const worn = [...st.previews.values()].filter(p => p.worn)
        if (worn.length) setTimeout(() => { try { st.toGame(worn) } catch (_) {} }, 1500)
      }
    })
  },
  view (state, ctx) {
    const st = this.st
    const rows = []
    rows.push({ t: 'p', c: 'dim', text: 'Try on any clothing item. Only you see it; nothing is sent to Animal Jam.' })
    if (!st.me) rows.push({ t: 'p', c: 'warn', text: 'Put on or take off any item once, so JR can find your animal.' })
    rows.push({ t: 'in', id: 'q', label: 'Find an item', v: state.q || '', go: 'Search' })
    const q = String(state.q || '').trim().toLowerCase()
    if (q.length >= 2) {
      const hits = []
      for (const [id, def] of ctx.items.clothing || []) {
        if (def && def.name && def.name.toLowerCase().includes(q)) hits.push({ id: Number(id), name: def.name })
        if (hits.length >= 30) break
      }
      if (!hits.length) rows.push({ t: 'p', c: 'dim', text: ctx.items.ready ? 'No items match.' : 'Item names are still loading.' })
      for (const h of hits) rows.push({ t: 'li', text: h.name, sub: `#${h.id}`, sel: !!state.sel && state.sel.id === h.id, btns: [{ id: 'pick', label: 'Pick', v: String(h.id) }] })
    }
    if (state.sel) {
      rows.push({ t: 'sep' })
      rows.push({ t: 'h', text: state.sel.name })
      if (st.colors.length > 1) rows.push({ t: 'chips', id: 'color', label: 'Color', v: String(state.color || 0), opts: st.colors.map((_, i) => ({ v: String(i), l: String(i + 1) })) })
      rows.push({ t: 'btn', id: 'try', label: 'Try it on', style: 'primary' })
    }
    const list = [...st.previews.values()]
    if (list.length) {
      rows.push({ t: 'sep' })
      rows.push({ t: 'h', text: 'Trying on' })
      for (const p of list) rows.push({ t: 'li', text: p.name, sub: st.colors.length > 1 ? `color ${p.colorIndex + 1}` : null, btns: [{ id: p.worn ? 'off' : 'on', label: p.worn ? 'Take off' : 'Put on', v: String(p.slot) }] })
      rows.push({ t: 'btn', id: 'alloff', label: 'Take them all off' })
    }
    return { title: 'Try On', rows, h: 330 }
  },
  async act (state, c, v, inputs, ctx) {
    const st = this.st
    if (c === 'q') { state.q = v; return }
    if (c === 'pick') {
      const id = Number(v)
      const def = ctx.items.getClothing(id)
      state.sel = { id, name: (def && def.name) || `Item #${id}` }
      state.color = 0
      st.colors = []
      try {
        if (!st.pack) st.pack = ctx.items.fetchPack(ctx.items.deployVersion, '1000')
        const pack = await st.pack
        const raw = pack && (pack[id] || Object.values(pack).find(e => e && String(e.id) === String(id)))
        st.colors = raw && raw.colors != null && raw.colors !== '' ? String(raw.colors).split(',').map(x => Number(x.trim())).filter(Number.isFinite).map(x => x | 0) : []
      } catch (_) { st.pack = null }
      return
    }
    if (c === 'color') { state.color = Number(v) || 0; return }
    if (c === 'try' && state.sel) {
      const i = Math.min(Number(state.color) || 0, Math.max(0, st.colors.length - 1))
      const p = { slot: st.next++, id: state.sel.id, name: state.sel.name, colorIndex: i, colorValue: st.colors.length ? st.colors[i] : 0, worn: true }
      st.add(p)
      st.toGame([p])
      st.previews.set(p.slot, p)
      return
    }
    if (c === 'on' || c === 'off') {
      const p = st.previews.get(Number(v))
      if (p) { p.worn = c === 'on'; st.toGame([p]) }
      return
    }
    if (c === 'alloff') {
      const worn = [...st.previews.values()].filter(p => p.worn)
      worn.forEach(p => { p.worn = false })
      if (worn.length) st.toGame(worn)
    }
  }
}

/* ------------------------------------------------------------ glow picker */

const PRESETS = ['#ff2fc8', '#ff00ff', '#ff0000', '#ff8a00', '#ffc400', '#ffe600', '#a6ff00', '#1aff4a', '#00e5ff', '#0040ff', '#9b30ff', '#ff4fa0', '#ffffff', '#000000']
const SWAPS = [
  { name: 'Red & Blue', colors: ['#ff0000', '#0040ff'] },
  { name: 'Black & White', colors: ['#000000', '#ffffff'] },
  { name: 'Christmas', colors: ['#ff0000', '#1aff4a'] },
  { name: 'Neon', colors: ['#ff2fc8', '#00e5ff'] },
  { name: 'Fire', colors: ['#ff0000', '#ff8a00', '#ffe600'] },
  { name: 'Ice', colors: ['#00e5ff', '#ffffff'] },
  { name: 'Gold & Black', colors: ['#ffc400', '#000000'] },
  { name: 'Halloween', colors: ['#ff8a00', '#9b30ff'] },
  { name: 'Ocean', colors: ['#0040ff', '#00e5ff', '#00b3a4'] },
  { name: 'Candy', colors: ['#ff4fa0', '#ffffff'] },
  { name: 'Rainbow', colors: ['#ff0000', '#ff8a00', '#ffe600', '#1aff4a', '#00e5ff', '#0040ff', '#9b30ff'] }
]
const MIN_SPEED = 600
const hexToRgb = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim()); if (!m) return null; const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 } }
const glowValue = ({ r, g, b }, a = 255) => ((a << 24) | (r << 16) | (g << 8) | b) >>> 0

const glow = {
  id: 'glow',
  plugin: 'glow-picker',
  buttons: [{ at: 'avatarcolors', label: 'Glow', icon: 'glow' }],
  init () { this.run = null },
  _send (ctx, value) {
    const room = ctx.dispatch.getState('room')
    if (!room) throw new Error('Join a room first.')
    return ctx.dispatch.sendRemoteMessage(`<msg t="sys"><body action="pubMsg" r="${room}"><txt><![CDATA[${value}%8]]></txt></body></msg>`)
  },
  _stop () { if (this.run) clearInterval(this.run.timer); this.run = null },
  _start (ctx, mode, colors, speed, name) {
    this._stop()
    const run = { mode, colors, i: 0, timer: null, name: name || '' }
    const tick = () => {
      let value
      if (mode === 'random') value = 1019311667 + Math.floor(Math.random() * (4294967295 - 1019311667 + 1))
      else { value = glowValue(hexToRgb(colors[run.i % colors.length])); run.i++ }
      Promise.resolve(this._send(ctx, value)).catch(() => {})
    }
    this.run = run
    run.timer = setInterval(() => {
      try { tick() } catch (e) { this._stop(); ctx.surfaces.toast(e.message, 'bad'); ctx.surfaces.refresh('glow') }
    }, Math.max(MIN_SPEED, speed))
    tick()
  },
  view (state, ctx) {
    const saved = ctx.surfaces.store('glow-picker').get('ingame', { color: '#ff2fc8', speed: 1000 })
    const run = this.run
    const rows = []
    rows.push({ t: 'p', c: 'dim', text: 'Pick a glow color for your animal. Everyone in the room sees it.' })
    rows.push({ t: 'sw', id: 'color', colors: PRESETS, v: saved.color })
    rows.push({ t: 'in', id: 'hex', label: 'Or type a color (#RRGGBB)', v: saved.color, go: 'Glow', max: 7 })
    rows.push({ t: 'sep' })
    rows.push({ t: 'h', text: 'Color swaps' })
    rows.push({ t: 'chips', id: 'swap', v: run && run.mode === 'swap' ? run.name : '', opts: SWAPS.map(s => ({ v: s.name, l: s.name })) })
    rows.push({ t: 'num', id: 'speed', label: 'Milliseconds between colors', v: saved.speed, step: 200 })
    rows.push({ t: 'row', items: [{ id: 'random', label: 'Random colors', style: run && run.mode === 'random' ? 'on' : 'normal' }, { id: 'stop', label: 'Stop', style: run ? 'danger' : 'normal' }] })
    if (run) rows.push({ t: 'p', c: 'ok', text: run.mode === 'random' ? 'Changing to random colors.' : `Swapping: ${run.name}.` })
    return { title: 'Glow', rows }
  },
  async act (state, c, v, inputs, ctx) {
    const store = ctx.surfaces.store('glow-picker')
    const saved = store.get('ingame', { color: '#ff2fc8', speed: 1000 })
    if (c === 'color' || c === 'hex') {
      const rgb = hexToRgb(v)
      if (!rgb) throw new Error('Type a color like #ff2fc8.')
      this._stop()
      saved.color = '#' + v.trim().replace('#', '').toLowerCase()
      store.set('ingame', saved)
      await this._send(ctx, glowValue(rgb))
      return
    }
    if (c === 'speed') {
      saved.speed = Math.max(MIN_SPEED, Math.min(10000, Number(v) || 1000))
      store.set('ingame', saved)
      if (this.run) this._start(ctx, this.run.mode, this.run.colors, saved.speed, this.run.name)
      return
    }
    if (c === 'swap') {
      const s = SWAPS.find(x => x.name === v)
      if (!s) return
      if (this.run && this.run.name === s.name) { this._stop(); return }
      this._start(ctx, 'swap', s.colors, saved.speed, s.name)
      return
    }
    if (c === 'random') { this._start(ctx, 'random', [], saved.speed, 'Random'); return }
    if (c === 'stop') this._stop()
  }
}

module.exports = [
  worthSurface('worth', ['clothing', 'den'], [{ at: 'avatar', label: 'Worth' }], 'Inventory Worth'),
  worthSurface('denworth', ['den'], [{ at: 'denedit', label: 'Worth' }], 'Den Item Worth'),
  tradeWorth,
  outfits,
  tryOn,
  glow
]
module.exports.inventoryOf = inventoryOf
