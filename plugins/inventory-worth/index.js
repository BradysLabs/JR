'use strict'

/* Inventory Worth, by BradysLabs: what your clothing and den items are worth. */
;(async function () {
  const $ = (id) => document.getElementById(id)
  const path = require('path')
  const fs = require('fs')
  const jam = window.jam || await new Promise(resolve => {
    const t = setInterval(() => { if (window.jam) { clearInterval(t); resolve(window.jam) } }, 40)
  })
  const items = jam.application.items
  const root = path.resolve(__dirname, '..', '..')
  const { createPricer } = require(path.join(root, 'src', 'worth', 'pricer.js'))
  const escape = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  let tab = 'all'
  let pricer = null
  let rows = []
  let lastKey = ''

  $('status').textContent = 'Loading item names and wiki values…'
  if (!items.ready) {
    try { await items.load() } catch (e) { $('status').textContent = `Item names aren't available yet: ${e.message}. Open the game, then reopen this window.`; return }
  }
  pricer = createPricer({ root, items })

  /** Your inventory: live from the Inventory Reader, or its last saved copy. */
  function inventory () {
    const live = jam.dispatch.getState('jrInventory')
    if (live && typeof live.get === 'function') return live.get()
    try {
      const file = path.join(jam.application.dataPath, 'plugin-data', 'inventory-worth-capture', 'inventory.json')
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
      return { clothing: saved.items || [], den: saved.den || [], receivedAt: saved.receivedAt }
    } catch (_) { return { clothing: [], den: [], receivedAt: null } }
  }

  /** Groups copies of the same item (and color) and values each group. */
  function build (inv) {
    const groups = new Map()
    const add = (kind, defId, color) => {
      const key = `${kind}:${defId}:${color == null ? '' : color}`
      const g = groups.get(key)
      if (g) { g.count++; return }
      groups.set(key, { kind, id: defId, color, count: 1 })
    }
    for (const c of inv.clothing) add('clothing', c.defId, Number(c.color) >>> 0)
    for (const d of inv.den) add('den', d.defId, null)
    const out = []
    for (const g of groups.values()) {
      const v = pricer.value(g)
      const name = v.name || `${g.kind === 'den' ? 'Den item' : 'Item'} #${g.id}`
      const each = v.diamonds
      out.push({
        ...g,
        name,
        color: v.color,
        text: v.text,
        source: v.source,
        image: v.image,
        status: v.status,
        store: v.store,
        each,
        total: each ? { min: each.min * g.count, max: each.max * g.count } : null
      })
    }
    return out
  }

  const mid = (r) => (r ? (r.min + r.max) / 2 : -1)

  function renderStats (all) {
    const valued = all.filter(r => r.total)
    const sum = valued.reduce((s, r) => ({ min: s.min + r.total.min, max: s.max + r.total.max }), { min: 0, max: 0 })
    const copies = all.reduce((n, r) => n + r.count, 0)
    const valuedCopies = valued.reduce((n, r) => n + r.count, 0)
    if (valued.length) {
      const text = pricer.format(sum)
      const [d, bl] = text.split(' · ')
      $('total').textContent = d.replace('≈ ', '≈ ')
      $('totalSub').textContent = bl ? `${bl} (Black Long Collars)` : 'in Diamonds'
    } else {
      $('total').textContent = '—'
      $('totalSub').textContent = all.length ? 'No wiki values found yet' : ' '
    }
    $('valued').textContent = `${valuedCopies.toLocaleString()} / ${copies.toLocaleString()}`
    $('valuedSub').textContent = `${valued.length.toLocaleString()} different items`
    const top = valued.slice().sort((a, b) => mid(b.each) - mid(a.each))[0]
    $('top').textContent = top ? `${top.name}${top.color ? ` · ${top.color}` : ''}` : '—'
    $('top').title = $('top').textContent
    $('topSub').textContent = top ? pricer.format(top.each, { bl: false }) : ' '
  }

  function renderList () {
    const q = $('search').value.trim().toLowerCase()
    const valuedOnly = $('valuedOnly').checked
    const sort = $('sort').value
    let shown = rows
      .filter(r => tab === 'all' || r.kind === tab)
      .filter(r => !valuedOnly || r.total || r.store)
      .filter(r => !q || `${r.name} ${r.color || ''}`.toLowerCase().includes(q))
    shown = shown.slice().sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name)
      : sort === 'count' ? b.count - a.count || mid(b.total) - mid(a.total)
        : mid(b.total) - mid(a.total) || a.name.localeCompare(b.name))
    const list = $('list')
    if (!rows.length) {
      list.innerHTML = '<div class="empty">JR hasn\'t seen your inventory yet.<br>Open your clothing inventory in Animal Jam, and go to your den once for den items.</div>'
      return
    }
    if (!shown.length) {
      list.innerHTML = `<div class="empty">${valuedOnly ? 'No valued items here. Untick “Valued only” to see everything.' : 'Nothing matches your search.'}</div>`
      return
    }
    const limit = 400
    list.innerHTML = shown.slice(0, limit).map(r => {
      const pic = r.image ? `<img src="${escape(r.image)}" alt="" loading="lazy" onerror="this.parentNode.textContent='${r.kind === 'den' ? '⌂' : '◇'}'">` : (r.kind === 'den' ? '⌂' : '◇')
      const worth = r.total
        ? `<div class="d">${escape(pricer.format(r.total, { bl: false }))}</div>${r.count > 1 ? `<div class="e">${escape(pricer.format(r.each, { bl: false }).replace('≈ ', ''))} each</div>` : ''}`
        : r.store && r.status !== 'unknown'
          ? `<div class="d store">${r.store.cost.toLocaleString()} ${escape(r.store.currency)}</div><div class="e">store price${r.store.members ? ' · members' : ''}</div>`
          : `<div class="none">${r.status === 'store' ? 'In stores' : r.status === 'unknown' ? 'Under investigation' : r.status === 'unclear' ? 'Several wiki values' : 'No value'}</div>`
      return `<div class="row"><div class="pic">${pic}</div><div class="info"><div class="name">${escape(r.name)}${r.color ? ` · ${escape(r.color)}` : ''}${r.count > 1 ? `<span class="n">×${r.count}</span>` : ''}<span class="tag">${r.kind === 'den' ? 'Den' : 'Clothing'}</span></div><div class="wiki">${escape(r.text || (r.status === 'unclear' ? 'The wiki values its versions differently, and JR can’t tell which one this is yet' : 'Not listed on the wiki'))}${r.text && r.source ? `<span class="src"> · from ${escape(r.source)}</span>` : ''}</div></div><div class="worth">${worth}</div></div>`
    }).join('') + (shown.length > limit ? `<div class="empty">Showing the first ${limit} of ${shown.length.toLocaleString()}. Search to find the rest.</div>` : '')
  }

  function refresh () {
    const inv = inventory()
    const key = `${inv.receivedAt}:${inv.clothing.length}:${inv.den.length}`
    if (key === lastKey) return
    lastKey = key
    rows = build(inv)
    const when = inv.receivedAt ? new Date(inv.receivedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
    $('status').textContent = rows.length
      ? `${inv.clothing.length.toLocaleString()} clothing · ${inv.den.length.toLocaleString()} den items${when ? ` · updated ${when}` : ''} · ${pricer.entries.toLocaleString()} wiki values`
      : 'Waiting for your inventory from Animal Jam.'
    renderStats(rows)
    renderList()
  }

  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]')
    if (!b) return
    tab = b.dataset.tab
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b))
    renderList()
  })
  $('search').addEventListener('input', renderList)
  $('sort').addEventListener('change', renderList)
  $('valuedOnly').addEventListener('change', renderList)

  refresh()
  setInterval(refresh, 2000)
})()
