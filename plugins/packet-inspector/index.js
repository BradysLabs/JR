const ANY = '*'
const CAP = 2000
const NOTES_FILE = 'notes.json'
const PREFS_KEY = 'packetInspectorPrefs'

const state = {
  packets: [],
  nextId: 1,
  selectedId: null,
  compareId: null,
  paused: false,
  follow: true,
  dir: 'all',
  view: 'live',
  pinnedOnly: false,
  room: null,
  query: { include: [], exclude: [], types: null, notTypes: [], regex: null, room: null }
}

const pinned = new Set()
const seen = new Map()
const examples = new Map()
const rateTimes = []
let jamRef = null
let notes = {}
const prefs = loadPrefs()

const $ = id => document.getElementById(id)

function loadPrefs () {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}
    return {
      hidden: Array.isArray(p.hidden) ? p.hidden : [],
      muted: Array.isArray(p.muted) ? p.muted : [],
      detailHeight: p.detailHeight || null
    }
  } catch (_) {
    return { hidden: [], muted: [], detailHeight: null }
  }
}

function savePrefs () {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch (_) {}
}

function pluginDir () {
  try {
    const path = require('path')
    let p = decodeURIComponent(new URL('.', location.href).pathname)
    if (process.platform === 'win32') p = p.replace(/^\//, '')
    return path.normalize(p)
  } catch (_) {
    return null
  }
}

function loadNotes () {
  try {
    const fs = require('fs')
    const file = require('path').join(pluginDir(), NOTES_FILE)
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (_) {}
  try { return JSON.parse(localStorage.getItem('packetInspectorNotes')) || {} } catch (_) { return {} }
}

function saveNotes () {
  const data = JSON.stringify(notes, null, 2)
  try {
    require('fs').writeFileSync(require('path').join(pluginDir(), NOTES_FILE), data)
  } catch (_) {
    try { localStorage.setItem('packetInspectorNotes', data) } catch (_) {}
  }
}

function def (type) {
  const base = PACKETS[type] || null
  const note = notes[type] || null
  if (!base && !note) return null
  return { ...(base || {}), ...(note || {}), mine: !!note }
}

function catOf (type) {
  const d = def(type)
  return d && CATEGORIES[d.cat] ? d.cat : 'unknown'
}

function escapeHtml (s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function stamp (t) {
  const d = new Date(t)
  const p = (n, l = 2) => String(n).padStart(l, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

function toast (text) {
  const t = $('toast')
  t.textContent = text
  t.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => t.classList.remove('show'), 1400)
}

function copy (text, label = 'Copied') {
  navigator.clipboard.writeText(text).then(() => toast(label)).catch(() => toast('Copy failed'))
}

function parseXt (raw) {
  if (typeof raw !== 'string' || !raw.startsWith('%xt%')) return null
  const parts = raw.split('%')
  const typeIdx = parts[2] === 'o' ? 3 : 2
  const args = parts.slice(typeIdx + 1)
  while (args.length && args[args.length - 1] === '') args.pop()
  return { type: parts[typeIdx], args }
}

function parseXml (raw) {
  if (typeof raw !== 'string' || !raw.startsWith('<')) return null
  const room = (/\br="([^"]*)"/.exec(raw) || [])[1]
  const txt = (/<!\[CDATA\[([\s\S]*?)\]\]>/.exec(raw) || /<txt>([\s\S]*?)<\/txt>/.exec(raw) || [])[1]
  return { room, txt }
}

function parseJson (raw) {
  if (typeof raw !== 'string' || !raw.startsWith('{')) return null
  try { return JSON.parse(raw) } catch (_) { return null }
}

function itemInfo (kind, id) {
  try {
    const items = jamRef && jamRef.application && jamRef.application.items
    if (!items || !items.ready || !/^\d+$/.test(String(id))) return null
    return kind === 'den' ? items.getDenItem(id) : items.getClothing(id)
  } catch (_) {
    return null
  }
}

function glowColor (value) {
  const hex = (Number(value) >>> 0).toString(16).padStart(8, '0')
  return { strength: parseInt(hex.slice(0, 2), 16), rgb: '#' + hex.slice(2) }
}

function swatch (rgb) {
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${rgb};vertical-align:middle;margin-right:5px;box-shadow:0 0 6px ${rgb}"></span>`
}

function pubMsgParts (pkt) {
  const x = parseXml(pkt.raw)
  const m = x && x.txt && /^(-?\d+)%(\d+)$/.exec(x.txt)
  return { x, value: m ? m[1] : null, kind: m ? m[2] : null }
}

function decode (pkt) {
  if (pkt.type === 'pubMsg') {
    const { x, value, kind } = pubMsgParts(pkt)
    if (kind === '8') {
      const c = glowColor(value)
      return `${swatch(c.rgb)}Glow color <b>${c.rgb}</b>, strength ${c.strength}`
    }
    if (kind === '2') return `Emote number <b>${escapeHtml(value)}</b>`
    if (kind) return `${escapeHtml(PUBMSG_KINDS[kind] || `Kind ${kind} (not mapped yet)`)}, value ${escapeHtml(value)}`
    if (x && x.txt) return `Text: "${escapeHtml(x.txt)}"`
  }
  if (pkt.type === 'uc') {
    const p = parseXt(pkt.raw)
    if (p && p.args[3] === '8') {
      const c = glowColor(p.args[2])
      return `${swatch(c.rgb)}Player ${escapeHtml(p.args[1])} glowing <b>${c.rgb}</b>`
    }
  }
  const json = parseJson(pkt.raw)
  if (json) return `<pre>${escapeHtml(JSON.stringify(json, null, 2))}</pre>`
  return null
}

function itemKindFor (d, dir, index, label, args) {
  const explicit = d && d.items && d.items[dir] && d.items[dir][index]
  if (explicit) return (!d.itemsWhen || d.itemsWhen(args, dir)) ? explicit : null
  if (/\bitem id\b/i.test(label) && !/\?/.test(label)) return /den/i.test(label) || /den/i.test((d && d.name) || '') ? 'den' : 'clothing'
  return null
}

function fieldsOf (pkt) {
  const d = def(pkt.type)
  const parsed = parseXt(pkt.raw)
  if (parsed) {
    const labels = (d && (pkt.dir === 'in' ? d.in : d.out)) || []
    return parsed.args.map((val, i) => {
      const label = labels[i] || '?'
      const kind = itemKindFor(d, pkt.dir, i, label, parsed.args)
      let note = null
      if (kind) {
        const item = itemInfo(kind, val)
        if (item) note = `${item.name || 'Unknown item'}${item.cost ? ` · value: ${item.cost} ${item.currency}` : ''}${item.members ? ' · members' : ''}`
      }
      if (/room id/i.test(label) && state.room && val === String(state.room)) note = 'your current room'
      return { idx: i, label, val, note }
    })
  }
  const x = parseXml(pkt.raw)
  if (x) {
    const out = []
    if (x.room !== undefined) out.push({ idx: 'r', label: 'room id', val: x.room, note: state.room && x.room === String(state.room) ? 'your current room' : null })
    if (x.txt !== undefined) out.push({ idx: 'txt', label: 'content', val: x.txt })
    return out
  }
  return []
}

function rowLabel (pkt) {
  const d = def(pkt.type)
  if (!d) return null
  const parsed = parseXt(pkt.raw)
  if (parsed) {
    const labels = (pkt.dir === 'in' ? d.in : d.out) || []
    for (let i = 0; i < parsed.args.length; i++) {
      const kind = itemKindFor(d, pkt.dir, i, labels[i] || '', parsed.args)
      const item = kind && itemInfo(kind, parsed.args[i])
      if (item && item.name) return `${d.name}: ${item.name}`
    }
  }
  if (pkt.type === 'pubMsg') {
    const { value, kind } = pubMsgParts(pkt)
    if (kind === '8') return 'Glow'
    if (kind === '2') return `Emote ${value}`
  }
  return d.name
}

function parseQuery (text) {
  const q = { include: [], exclude: [], types: null, notTypes: [], regex: null, room: null }
  let bad = false
  const tokens = text.match(/\/(?:\\.|[^/])+\/|\S+/g) || []
  for (const tok of tokens) {
    if (tok.length > 2 && tok.startsWith('/') && tok.endsWith('/')) {
      try { q.regex = new RegExp(tok.slice(1, -1), 'i') } catch (_) { bad = true }
    } else if (/^type:/i.test(tok)) {
      q.types = (q.types || []).concat(tok.slice(5).split(',').filter(Boolean))
    } else if (/^-type:/i.test(tok)) {
      q.notTypes.push(...tok.slice(6).split(',').filter(Boolean))
    } else if (/^room:/i.test(tok)) {
      q.room = tok.slice(5)
    } else if (tok.startsWith('-') && tok.length > 1) {
      q.exclude.push(tok.slice(1).toLowerCase())
    } else {
      q.include.push(tok.toLowerCase())
    }
  }
  $('search').classList.toggle('bad', bad)
  return q
}

function passesFilter (pkt) {
  if (state.dir !== 'all' && pkt.dir !== state.dir) return false
  if (state.pinnedOnly && !pinned.has(pkt.id)) return false
  if (prefs.muted.includes(pkt.type)) return false
  if (prefs.hidden.includes(catOf(pkt.type))) return false
  const q = state.query
  if (q.types && !q.types.includes(pkt.type)) return false
  if (q.notTypes.includes(pkt.type)) return false
  if (q.room && !pkt.raw.includes(`%${q.room}%`) && !pkt.raw.includes(`r="${q.room}"`)) return false
  if (q.regex && !q.regex.test(pkt.raw)) return false
  if (q.include.length || q.exclude.length) {
    const d = def(pkt.type)
    const hay = `${pkt.type} ${d ? d.name : ''} ${pkt.label || ''} ${pkt.raw}`.toLowerCase()
    if (!q.include.every(t => hay.includes(t))) return false
    if (q.exclude.some(t => pkt.type.toLowerCase() === t || hay.includes(t))) return false
  }
  return true
}

function visible () {
  return state.packets.filter(passesFilter)
}

function renderChips () {
  const counts = {}
  for (const p of state.packets) {
    const c = catOf(p.type)
    counts[c] = (counts[c] || 0) + 1
  }
  const chips = $('chips')
  chips.innerHTML = ''

  for (const [key, c] of Object.entries(CATEGORIES)) {
    const chip = document.createElement('span')
    chip.className = 'chip' + (prefs.hidden.includes(key) ? ' off' : '')
    chip.title = 'Click: show/hide. Double-click: show only this.'
    chip.innerHTML = `<span class="sw" style="background:${c.color}"></span>${c.label}<span class="n">${counts[key] || 0}</span>`
    chip.addEventListener('click', () => {
      prefs.hidden = prefs.hidden.includes(key) ? prefs.hidden.filter(k => k !== key) : [...prefs.hidden, key]
      savePrefs()
      refresh()
    })
    chip.addEventListener('dblclick', () => {
      const others = Object.keys(CATEGORIES).filter(k => k !== key)
      const solo = others.every(k => prefs.hidden.includes(k)) && !prefs.hidden.includes(key)
      prefs.hidden = solo ? [] : others
      savePrefs()
      refresh()
    })
    chips.appendChild(chip)
  }

  const pin = document.createElement('span')
  pin.className = 'chip' + (state.pinnedOnly ? ' on' : '')
  pin.innerHTML = `★ Pinned<span class="n">${pinned.size}</span>`
  pin.title = 'Show only pinned packets'
  pin.addEventListener('click', () => { state.pinnedOnly = !state.pinnedOnly; refresh() })
  chips.appendChild(pin)

  for (const type of prefs.muted) {
    const m = document.createElement('span')
    m.className = 'chip muted'
    m.title = 'Muted type. Click to unmute.'
    m.innerHTML = `muted <b>${escapeHtml(type)}</b><span class="x">×</span>`
    m.addEventListener('click', () => toggleMute(type))
    chips.appendChild(m)
  }

  if (prefs.hidden.length || prefs.muted.length || state.pinnedOnly) {
    const reset = document.createElement('span')
    reset.className = 'chip reset'
    reset.textContent = 'Reset filters'
    reset.addEventListener('click', () => {
      prefs.hidden = []
      prefs.muted = []
      state.pinnedOnly = false
      savePrefs()
      refresh()
    })
    chips.appendChild(reset)
  }
}

function rowEl (pkt) {
  const row = document.createElement('div')
  row.className = `row ${pkt.dir}` + (pkt.fromPlugin ? ' plugin' : '') +
    (pkt.id === state.selectedId ? ' selected' : '') +
    (pkt.id === state.compareId ? ' compare' : '')
  row.dataset.id = pkt.id
  const label = pkt.label
  row.innerHTML = `
    <span class="cat" style="background:${CATEGORIES[catOf(pkt.type)].color}"></span>
    <span class="pin">${pinned.has(pkt.id) ? '★' : ''}</span>
    <span class="arrow">${pkt.dir === 'in' ? '↓' : '↑'}</span>
    <span class="type">${escapeHtml(pkt.type)}</span>${pkt.fromPlugin ? '<span class="src" title="Sent by a plugin">plugin</span>' : ''}
    <span class="name${label ? '' : ' unknown'}" title="${escapeHtml(label || 'Not documented yet')}">${escapeHtml(label || 'Unknown')}</span>
    <span class="raw">${escapeHtml(pkt.raw)}</span>
    <span class="time">${stamp(pkt.t)}</span>`
  return row
}

function renderList () {
  const list = $('list')
  const shown = visible()
  if (!shown.length) {
    list.innerHTML = state.packets.length
      ? '<div class="empty">No packets match these filters.</div>'
      : '<div class="empty">Waiting for packets... play the game to see traffic.<br>Right-click a packet for more options.</div>'
    return
  }
  const frag = document.createDocumentFragment()
  shown.forEach(p => frag.appendChild(rowEl(p)))
  list.innerHTML = ''
  list.appendChild(frag)
  if (state.follow) list.scrollTop = list.scrollHeight
}

function appendRow (pkt) {
  const list = $('list')
  const empty = list.querySelector('.empty')
  if (empty) empty.remove()
  list.appendChild(rowEl(pkt))
  while (list.children.length > CAP) list.removeChild(list.firstChild)
  if (state.follow) list.scrollTop = list.scrollHeight
}

function confBadge (d) {
  if (!d) return '<span class="badge none" title="Nobody has documented this packet yet">undocumented</span>'
  const conf = CONFIDENCE[d.conf] ? `<span class="badge ${d.conf}" title="${escapeHtml(CONFIDENCE[d.conf])}">${d.conf}</span>` : ''
  return conf + (d.mine ? '<span class="badge mine" title="Includes your notes">your notes</span>' : '')
}

function catBadge (type) {
  const c = CATEGORIES[catOf(type)]
  return `<span class="badge cat" style="color:${c.color}">${c.label}</span>`
}

function fieldTable (fields, other) {
  if (!fields.length) return '<div class="placeholder">No field breakdown for this packet.</div>'
  const rows = fields.map((f, i) => {
    const o = other ? other[i] : null
    const diff = other && (!o || o.val !== f.val)
    const q = f.label.includes('?') ? ' q' : ''
    const note = f.note ? `<div class="note">${escapeHtml(f.note)}</div>` : ''
    const second = other
      ? `<td class="val b" data-copy="${escapeHtml(o ? o.val : '')}">${o ? escapeHtml(o.val) : '<i>missing</i>'}${o && o.note ? `<div class="note">${escapeHtml(o.note)}</div>` : ''}</td>`
      : ''
    return `<tr class="${diff ? 'diff' : ''}"><td class="idx">${f.idx}</td><td class="lab${q}">${escapeHtml(f.label)}</td><td class="val" data-copy="${escapeHtml(f.val)}">${escapeHtml(f.val)}${note}</td>${second}</tr>`
  })
  if (other && other.length > fields.length) {
    for (let i = fields.length; i < other.length; i++) {
      rows.push(`<tr class="diff"><td class="idx">${other[i].idx}</td><td class="lab q">${escapeHtml(other[i].label)}</td><td class="val"><i>missing</i></td><td class="val b">${escapeHtml(other[i].val)}</td></tr>`)
    }
  }
  const head = other ? '<th>#</th><th>Field</th><th>Selected</th><th>Compared</th>' : '<th>#</th><th>Field</th><th>Value</th>'
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`
}

function renderDetail () {
  const detail = $('detail')
  const pkt = state.packets.find(p => p.id === state.selectedId)
  if (!pkt) {
    detail.innerHTML = `<div class="placeholder">Click a packet to see what it means.<br>
      <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Ctrl</kbd>+click compare · right-click for options · <kbd>Space</kbd> pause · <kbd>Ctrl</kbd>+<kbd>F</kbd> search</div>`
    return
  }

  const d = def(pkt.type)
  const other = state.packets.find(p => p.id === state.compareId) || null
  const fields = fieldsOf(pkt)
  const decoded = decode(pkt)
  const sameTypeCount = state.packets.filter(p => p.type === pkt.type).length
  const prev = state.packets.slice(0, state.packets.indexOf(pkt)).reverse().find(p => p.type === pkt.type)

  detail.innerHTML = `
    <div class="head">
      <span class="dname">${escapeHtml(d ? d.name : pkt.type)}</span>
      <span class="badge ${pkt.dir}">${pkt.dir === 'in' ? 'incoming' : 'outgoing'}</span>
      ${catBadge(pkt.type)}
      ${confBadge(d)}
      <span class="spacer"></span>
      <button class="btn small" id="dPin">${pinned.has(pkt.id) ? 'Unpin' : 'Pin'}</button>
      <button class="btn small" id="dNotes">${d ? 'Edit notes' : 'Add notes'}</button>
      <button class="btn small" id="dCopy">Copy</button>
    </div>
    <div class="desc">${escapeHtml(d ? d.desc || '' : 'Not documented yet. Use "Add notes" to write down what it does.')}</div>
    <div class="meta">${stamp(pkt.t)} · ${pkt.raw.length} chars · ${sameTypeCount} × ${escapeHtml(pkt.type)} in buffer${prev ? ` · ${((pkt.t - prev.t) / 1000).toFixed(2)}s since last` : ''}</div>
    <div class="scroll">
      <div class="rawline"><code>${escapeHtml(pkt.raw)}</code></div>
      ${other ? `<div class="rawline b"><code>${escapeHtml(other.raw)}</code></div>` : ''}
      ${decoded ? `<div class="decoded">${decoded}</div>` : ''}
      <div class="fields">${fieldTable(fields, other ? fieldsOf(other) : null)}</div>
      ${other ? '<div class="placeholder" style="padding:8px">Red rows differ. <kbd>Esc</kbd> to stop comparing.</div>' : ''}
    </div>`

  $('dCopy').addEventListener('click', () => copy(pkt.raw))
  $('dPin').addEventListener('click', () => togglePin(pkt.id))
  $('dNotes').addEventListener('click', () => openEditor(detail, pkt.type, renderDetail, fields.length, pkt.dir))
  detail.querySelectorAll('[data-copy]').forEach(td => td.addEventListener('click', () => copy(td.dataset.copy, `Copied ${td.dataset.copy}`)))
}

function openEditor (container, type, onDone, fieldCount = 0, dir = null) {
  const d = def(type) || {}
  const blank = n => Array.from({ length: n }, () => '?').join('\n')
  const outText = d.out ? d.out.join('\n') : (dir === 'out' ? blank(fieldCount) : '')
  const inText = d.in ? d.in.join('\n') : (dir === 'in' ? blank(fieldCount) : '')
  const catOptions = Object.entries(CATEGORIES)
    .map(([k, c]) => `<option value="${k}"${(d.cat || 'unknown') === k ? ' selected' : ''}>${c.label}</option>`).join('')
  const confOptions = Object.keys(CONFIDENCE)
    .map(k => `<option value="${k}"${(d.conf || 'guess') === k ? ' selected' : ''}>${k}: ${escapeHtml(CONFIDENCE[k].split(': ')[1])}</option>`).join('')

  container.innerHTML = `
    <div class="head"><span class="dname">Notes for <code>${escapeHtml(type)}</code></span></div>
    <div class="editor">
      <label>Name<input id="nName" value="${escapeHtml(d.name || '')}" placeholder="e.g. Buy Item"></label>
      <label>Category<select id="nCat">${catOptions}</select></label>
      <label class="wide">Confidence<select id="nConf">${confOptions}</select></label>
      <label class="wide">What it does<textarea id="nDesc" placeholder="Plain-English explanation">${escapeHtml(d.desc || '')}</textarea></label>
      <label>Outgoing fields (one per line, ? = unknown)<textarea id="nOut" rows="6">${escapeHtml(outText)}</textarea></label>
      <label>Incoming fields (one per line, ? = unknown)<textarea id="nIn" rows="6">${escapeHtml(inText)}</textarea></label>
      <div class="actions">
        ${notes[type] ? '<button class="btn" id="nReset">Remove my notes</button>' : ''}
        <span class="spacer"></span>
        <button class="btn" id="nCancel">Cancel</button>
        <button class="btn primary" id="nSave">Save</button>
      </div>
    </div>`

  const q = id => container.querySelector('#' + id)
  const lines = v => {
    const arr = v.split('\n').map(s => s.trim() || '?')
    while (arr.length && arr[arr.length - 1] === '?') arr.pop()
    return arr
  }

  q('nName').focus()
  q('nCancel').addEventListener('click', onDone)
  if (q('nReset')) {
    q('nReset').addEventListener('click', () => {
      delete notes[type]
      saveNotes()
      relabel(type)
      refresh()
      onDone()
      toast(`Removed notes for ${type}`)
    })
  }
  q('nSave').addEventListener('click', () => {
    const entry = {
      name: q('nName').value.trim() || type,
      cat: q('nCat').value,
      conf: q('nConf').value,
      desc: q('nDesc').value.trim()
    }
    const out = lines(q('nOut').value)
    const inn = lines(q('nIn').value)
    if (out.length) entry.out = out
    if (inn.length) entry.in = inn
    notes[type] = entry
    saveNotes()
    relabel(type)
    refresh()
    onDone()
    toast(`Saved notes for ${type}`)
  })
}

function relabel (type) {
  state.packets.forEach(p => { if (!type || p.type === type) p.label = rowLabel(p) })
}

function fieldGrid (labels) {
  return labels.map((l, i) => `<span class="k">${i}</span><span class="v${l.includes('?') ? ' q' : ''}">${escapeHtml(l)}</span>`).join('')
}

function cardEl (type) {
  const d = def(type)
  const card = document.createElement('div')
  card.className = 'card'
  const count = seen.get(type) || 0
  const ex = examples.get(type)
  card.innerHTML = `
    <div class="top">
      <code>${escapeHtml(type)}</code>
      <span class="cname">${escapeHtml(d ? d.name : 'Undocumented')}</span>
      ${confBadge(d)}
      <span class="seen">${count ? `seen ${count}×` : 'not seen this session'}</span>
    </div>
    <p>${escapeHtml(d ? d.desc || '' : 'Seen in traffic but not documented yet.')}</p>
    ${d && d.out ? `<div class="dirl" style="color:var(--out)">↑ OUTGOING</div><div class="flds">${fieldGrid(d.out)}</div>` : ''}
    ${d && d.in ? `<div class="dirl" style="color:var(--in)">↓ INCOMING</div><div class="flds">${fieldGrid(d.in)}</div>` : ''}
    ${ex ? `<div class="example" title="${escapeHtml(ex)}">e.g. ${escapeHtml(ex)}</div>` : ''}
    <div class="acts">
      <button class="btn small" data-a="notes">${d ? 'Edit notes' : 'Add notes'}</button>
      ${count ? '<button class="btn small" data-a="show">Show in Live</button>' : ''}
    </div>`
  card.querySelector('[data-a=notes]').addEventListener('click', () => openEditor(card, type, renderGuide))
  const show = card.querySelector('[data-a=show]')
  if (show) {
    show.addEventListener('click', () => {
      $('search').value = `type:${type}`
      state.query = parseQuery($('search').value)
      setView('live')
    })
  }
  return card
}

function renderGuide () {
  const guide = $('guide')
  const q = state.query
  const types = new Set([...Object.keys(PACKETS), ...Object.keys(notes), ...seen.keys()])
  const groups = {}
  let documented = 0
  let confirmed = 0
  let undocumentedSeen = 0

  for (const type of types) {
    const d = def(type)
    if (d) documented++
    if (d && d.conf === 'confirmed') confirmed++
    if (!d && seen.has(type)) undocumentedSeen++

    const cat = catOf(type)
    if (prefs.hidden.includes(cat)) continue
    if (q.types && !q.types.includes(type)) continue
    const hay = `${type} ${d ? `${d.name} ${d.desc || ''} ${(d.out || []).join(' ')} ${(d.in || []).join(' ')}` : ''}`.toLowerCase()
    if (!q.include.every(t => hay.includes(t))) continue
    if (q.exclude.some(t => hay.includes(t))) continue
    if (state.dir === 'in' && d && !d.in && d.out) continue
    if (state.dir === 'out' && d && !d.out && d.in) continue
    ;(groups[cat] = groups[cat] || []).push(type)
  }

  guide.innerHTML = `
    <div class="gstats">
      <div class="gstat"><div class="v">${documented}</div><div class="k">documented</div></div>
      <div class="gstat"><div class="v">${confirmed}</div><div class="k">confirmed</div></div>
      <div class="gstat"><div class="v">${seen.size}</div><div class="k">types seen</div></div>
      <div class="gstat"><div class="v" style="color:${undocumentedSeen ? 'var(--err)' : 'inherit'}">${undocumentedSeen}</div><div class="k">seen, undocumented</div></div>
    </div>`

  if (!Object.keys(groups).length) {
    guide.insertAdjacentHTML('beforeend', '<div class="empty">Nothing matches these filters.</div>')
    return
  }

  const sortKey = t => (seen.get(t) ? 0 : 1) + t
  for (const cat of Object.keys(CATEGORIES)) {
    if (!groups[cat]) continue
    const c = CATEGORIES[cat]
    const section = document.createElement('div')
    section.className = 'group'
    section.innerHTML = `<h2><span class="sw" style="background:${c.color}"></span>${c.label} <span style="opacity:.6">(${groups[cat].length})</span></h2>`
    groups[cat].sort((a, b) => sortKey(a).localeCompare(sortKey(b))).forEach(type => section.appendChild(cardEl(type)))
    guide.appendChild(section)
  }
}

function refresh () {
  renderChips()
  if (state.view === 'live') {
    renderList()
    renderDetail()
  } else {
    renderGuide()
  }
}

function setView (v) {
  state.view = v
  document.querySelectorAll('#view button').forEach(b => b.classList.toggle('active', b.dataset.view === v))
  $('live').classList.toggle('hidden', v !== 'live')
  $('guide').classList.toggle('hidden', v !== 'guide')
  ;['follow', 'pause', 'clear', 'rate'].forEach(id => $(id).classList.toggle('hidden', v !== 'live'))
  refresh()
}

function select (id, compare = false) {
  if (compare && state.selectedId && id !== state.selectedId) {
    state.compareId = state.compareId === id ? null : id
  } else {
    state.selectedId = id
    if (state.compareId === id) state.compareId = null
  }
  document.querySelectorAll('.row').forEach(r => {
    const rid = Number(r.dataset.id)
    r.classList.toggle('selected', rid === state.selectedId)
    r.classList.toggle('compare', rid === state.compareId)
  })
  renderDetail()
}

function togglePin (id) {
  if (pinned.has(id)) pinned.delete(id)
  else pinned.add(id)
  refresh()
}

function toggleMute (type) {
  prefs.muted = prefs.muted.includes(type) ? prefs.muted.filter(t => t !== type) : [...prefs.muted, type]
  savePrefs()
  refresh()
  toast(prefs.muted.includes(type) ? `Muted ${type}` : `Unmuted ${type}`)
}

function asText (list) {
  return list.map(p => `${p.dir === 'in' ? '↓' : '↑'}${p.fromPlugin ? ' [plugin]' : ''} ${p.raw}${p.label ? `  (${p.label})` : ''}`).join('\n')
}

function download (name, content, mime) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type: mime }))
  a.download = name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
}

function showMenu (x, y, items) {
  const menu = $('menu')
  menu.innerHTML = ''
  for (const item of items) {
    if (item === '-') { menu.appendChild(document.createElement('hr')); continue }
    const div = document.createElement('div')
    div.textContent = item.label
    div.addEventListener('click', () => { hideMenu(); item.run() })
    menu.appendChild(div)
  }
  menu.classList.remove('hidden')
  const r = menu.getBoundingClientRect()
  menu.style.left = Math.min(x, innerWidth - r.width - 6) + 'px'
  menu.style.top = Math.min(y, innerHeight - r.height - 6) + 'px'
}

function hideMenu () {
  $('menu').classList.add('hidden')
}

function rowMenu (e, pkt) {
  e.preventDefault()
  const items = [
    { label: pinned.has(pkt.id) ? 'Unpin' : 'Pin', run: () => togglePin(pkt.id) },
    { label: 'Copy raw', run: () => copy(pkt.raw) }
  ]
  if (state.selectedId && state.selectedId !== pkt.id) items.push({ label: 'Compare with selected', run: () => select(pkt.id, true) })
  items.push('-',
    { label: `Show only ${pkt.type}`, run: () => { $('search').value = `type:${pkt.type}`; state.query = parseQuery($('search').value); refresh() } },
    { label: `Mute ${pkt.type}`, run: () => toggleMute(pkt.type) },
    { label: `Hide ${CATEGORIES[catOf(pkt.type)].label}`, run: () => { prefs.hidden.push(catOf(pkt.type)); savePrefs(); refresh() } },
    '-',
    { label: def(pkt.type) ? `Edit notes for ${pkt.type}` : `Add notes for ${pkt.type}`, run: () => { select(pkt.id); openEditor($('detail'), pkt.type, renderDetail, fieldsOf(pkt).length, pkt.dir) } }
  )
  showMenu(e.clientX, e.clientY, items)
}

function exportMenu (e) {
  const shown = visible()
  const pins = state.packets.filter(p => pinned.has(p.id))
  const items = [
    { label: `Copy visible as text (${shown.length})`, run: () => copy(asText(shown), `Copied ${shown.length} packets`) },
    { label: `Copy pinned as text (${pins.length})`, run: () => copy(asText(pins), `Copied ${pins.length} packets`) },
    '-',
    { label: `Save visible as .txt (${shown.length})`, run: () => download(`packets-${Date.now()}.txt`, asText(shown), 'text/plain') },
    { label: `Save visible as .json (${shown.length})`, run: () => download(`packets-${Date.now()}.json`, JSON.stringify(shown.map(p => ({ time: new Date(p.t).toISOString(), dir: p.dir, type: p.type, name: p.label, raw: p.raw })), null, 2), 'application/json') },
    '-',
    { label: 'Export my notes (notes.json)', run: () => download('notes.json', JSON.stringify(notes, null, 2), 'application/json') }
  ]
  const r = e.currentTarget.getBoundingClientRect()
  showMenu(r.left, r.bottom + 4, items)
}

// Streaming mode: show the display name instead of the real username.
function maskName (text) {
  const streaming = jamRef && jamRef.application && jamRef.application.streamingMode
  return hideSecrets(streaming && typeof streaming.mask === 'function' ? streaming.mask(text) : text)
}

// Login tokens, hashes and emails are never shown, copied or exported.
function hideSecrets (text) {
  const shared = jamRef && jamRef.application && jamRef.application.hideSecrets
  if (typeof shared === 'function') return shared(text)
  return String(text)
    .replace(/(<pword>\s*(?:<!\[CDATA\[)?)[\s\S]*?((?:\]\]>)?\s*<\/pword>)/gi, '$1[hidden]$2')
    .replace(/\bh=(['"])[^'"]*\1/g, 'h=$1[hash]$1')
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[token]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
}

function onPacket ({ type, message }) {
  let raw = ''
  try { raw = message.toMessage() } catch (_) { raw = String(message && message.value) }
  ingest({
    raw,
    type: message && message.type,
    dir: type === 'aj' ? 'in' : 'out',
    fromPlugin: false
  })
}

// Packets sent by plugins (they don't pass through the proxy hooks).
function onPluginPacket (packet) {
  if (!packet || !packet.fromPlugin) return
  ingest({ raw: packet.raw, type: packet.type, dir: packet.direction, fromPlugin: true })
}

function ingest ({ raw, type, dir, fromPlugin }) {
  raw = maskName(String(raw || ''))
  const pktType = type || (parseXt(raw) || {}).type || '?'

  seen.set(pktType, (seen.get(pktType) || 0) + 1)
  if (!examples.has(pktType)) examples.set(pktType, raw)
  rateTimes.push(Date.now())

  if (pktType === 'rj' && dir === 'in') {
    const p = parseXt(raw)
    if (p && p.args[0]) state.room = p.args[0]
  }

  if (state.paused) return

  const pkt = { id: state.nextId++, dir, type: pktType, raw, t: Date.now(), fromPlugin }
  pkt.label = rowLabel(pkt)
  state.packets.push(pkt)

  if (state.packets.length > CAP) {
    const dropped = state.packets.shift()
    pinned.delete(dropped.id)
  }

  if (state.view === 'live' && passesFilter(pkt)) appendRow(pkt)
  scheduleChips()
}

let chipTimer = null
function scheduleChips () {
  if (chipTimer) return
  chipTimer = setTimeout(() => {
    chipTimer = null
    renderChips()
    if (state.view === 'guide') renderGuide()
  }, 700)
}

function updateRate () {
  const cutoff = Date.now() - 1000
  while (rateTimes.length && rateTimes[0] < cutoff) rateTimes.shift()
  $('rate').textContent = `${rateTimes.length}/s`
}

function setPaused (v) {
  state.paused = v
  $('pause').textContent = v ? 'Resume' : 'Pause'
  $('pause').classList.toggle('warn', v)
  $('pause').classList.toggle('active', v)
  $('dot').classList.toggle('paused', v)
}

function moveSelection (step) {
  const shown = visible()
  if (!shown.length) return
  let i = shown.findIndex(p => p.id === state.selectedId)
  i = i === -1 ? (step > 0 ? 0 : shown.length - 1) : Math.max(0, Math.min(shown.length - 1, i + step))
  select(shown[i].id)
  const row = document.querySelector(`.row[data-id="${shown[i].id}"]`)
  if (row) row.scrollIntoView({ block: 'nearest' })
}

function initResizer () {
  const detail = $('detail')
  if (prefs.detailHeight) detail.style.height = prefs.detailHeight + 'px'
  $('resizer').addEventListener('mousedown', (e) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = detail.getBoundingClientRect().height
    const move = (ev) => {
      const h = Math.max(120, Math.min(innerHeight - 200, startH - (ev.clientY - startY)))
      detail.style.height = h + 'px'
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      prefs.detailHeight = detail.getBoundingClientRect().height
      savePrefs()
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  })
}

function waitForJam () {
  return new Promise(resolve => {
    if (window.jam && window.jam.dispatch) return resolve(window.jam)
    const t = setInterval(() => {
      if (window.jam && window.jam.dispatch) { clearInterval(t); resolve(window.jam) }
    }, 100)
  })
}

document.addEventListener('DOMContentLoaded', async () => {
  notes = loadNotes()
  initResizer()

  let searchTimer = null
  $('search').addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { state.query = parseQuery($('search').value); refresh() }, 120)
  })

  $('dir').addEventListener('click', (e) => {
    const btn = e.target.closest('button')
    if (!btn) return
    state.dir = btn.dataset.dir
    document.querySelectorAll('#dir button').forEach(b => b.classList.toggle('active', b === btn))
    refresh()
  })

  $('view').addEventListener('click', (e) => {
    const btn = e.target.closest('button')
    if (btn) setView(btn.dataset.view)
  })

  $('list').addEventListener('click', (e) => {
    const row = e.target.closest('.row')
    if (row) select(Number(row.dataset.id), e.ctrlKey || e.metaKey)
  })
  $('list').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.row')
    const pkt = row && state.packets.find(p => p.id === Number(row.dataset.id))
    if (pkt) rowMenu(e, pkt)
  })
  $('list').addEventListener('scroll', () => {
    const list = $('list')
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 30
    if (atBottom !== state.follow) {
      state.follow = atBottom
      $('follow').classList.toggle('active', atBottom)
    }
  })

  $('follow').addEventListener('click', () => {
    state.follow = !state.follow
    $('follow').classList.toggle('active', state.follow)
    if (state.follow) $('list').scrollTop = $('list').scrollHeight
  })
  $('pause').addEventListener('click', () => setPaused(!state.paused))
  $('export').addEventListener('click', exportMenu)
  $('clear').addEventListener('click', () => {
    const keep = state.packets.filter(p => pinned.has(p.id))
    state.packets = keep
    if (!keep.some(p => p.id === state.selectedId)) state.selectedId = null
    if (!keep.some(p => p.id === state.compareId)) state.compareId = null
    refresh()
    toast(keep.length ? `Cleared (kept ${keep.length} pinned)` : 'Cleared')
  })

  document.addEventListener('click', (e) => { if (!e.target.closest('#menu')) hideMenu() })
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      $('search').focus()
      $('search').select()
      return
    }
    if (e.key === 'Escape') {
      hideMenu()
      if (typing) { document.activeElement.blur(); return }
      if (state.compareId) { state.compareId = null; refresh() } else if (state.selectedId) { state.selectedId = null; refresh() }
      return
    }
    if (typing || state.view !== 'live') return
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1) }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1) }
    if (e.key === ' ') { e.preventDefault(); setPaused(!state.paused) }
    if (e.key.toLowerCase() === 'p' && state.selectedId) togglePin(state.selectedId)
    if (e.key.toLowerCase() === 'c' && state.selectedId) {
      const pkt = state.packets.find(p => p.id === state.selectedId)
      if (pkt) copy(pkt.raw)
    }
  })

  setInterval(updateRate, 500)
  refresh()

  jamRef = await waitForJam()
  try {
    const room = await jamRef.dispatch.getState('room')
    if (room) state.room = room
  } catch (_) {}
  if (jamRef.application && jamRef.application.items && jamRef.application.items.load) {
    jamRef.application.items.load().then(() => { relabel(); refresh() }).catch(() => {})
  }
  jamRef.dispatch.onMessage({ type: ANY, callback: onPacket })
  let stopPluginPackets = null
  if (typeof jamRef.onPacket === 'function') stopPluginPackets = jamRef.onPacket(onPluginPacket)
  else if (typeof jamRef.dispatch.onPacket === 'function') stopPluginPackets = jamRef.dispatch.onPacket(onPluginPacket)
  window.addEventListener('beforeunload', () => {
    try { jamRef.dispatch.offMessage({ type: ANY, callback: onPacket }) } catch (_) {}
    try { if (stopPluginPackets) stopPluginPackets() } catch (_) {}
  })
})
