const CONTENT_URL = 'https://ajcontent.akamaized.net'
const HASH_KEY = 'W3 7r4Ck h4X0r3rs'
const ROW_H = 30
const PACKS = {
  clothing: { id: '1000', label: 'Clothing', nameKey: 'titleStrId' },
  animals: { id: '1003', label: 'Animals', nameKey: 'titleStrRef' },
  den: { id: '1030', label: 'Den Items', nameKey: 'nameStrId' },
  pets: { id: '1046', label: 'Pets', nameKey: 'titleStrId' },
  strings: { id: '10230', label: 'Text strings' }
}
const KNOWN_PACKS = [
  ...Object.values(PACKS),
  { id: '1011', label: 'Rooms' },
  { id: '1025', label: 'Quest / adventure NPCs' },
  { id: '1027', label: 'Item list data' },
  { id: '1029', label: 'Image arrays' },
  { id: '1036', label: 'Emotes' },
  { id: '1038', label: 'Generic lists' },
  { id: '1040', label: 'Den rooms' },
  { id: '1042', label: 'Achievements' },
  { id: '1047', label: 'Parties' },
  { id: '1049', label: 'Name bar badges' },
  { id: '1050', label: 'Battle cards' },
  { id: '1051', label: 'Currency exchange' },
  { id: '1052', label: 'Adventure scripts' },
  { id: '1053', label: 'Movies / cutscenes' },
  { id: '1054', label: 'Diamond shop' },
  { id: '1057', label: 'Unidentified (1057)' },
  { id: '1058', label: 'Unidentified (1058)' },
  { id: '1061', label: 'Adopt-a-Pet' },
  { id: '1062', label: 'Unidentified (1062)' },
  { id: '1063', label: 'Unidentified (1063)' },
  { id: '1064', label: 'World items' },
  { id: '1065', label: 'Newspaper' }
].sort((a, b) => Number(a.id) - Number(b.id))

const $ = id => document.getElementById(id)

const state = {
  tab: 'clothing',
  members: 'all',
  currency: 'all',
  sort: { key: 'id', dir: 1 },
  list: [],
  filtered: [],
  selected: null,
  deploy: null
}

let items = null
const rawPacks = new Map()
let currentPack = null

function escapeHtml (s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function toast (text) {
  const t = $('toast')
  t.textContent = text
  t.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => t.classList.remove('show'), 1400)
}

function copy (text, label) {
  navigator.clipboard.writeText(String(text)).then(() => toast(label || 'Copied')).catch(() => toast('Copy failed'))
}

function setStatus (text, kind) {
  $('status').textContent = text
  $('dot').className = 'dot' + (kind ? ' ' + kind : '')
}

function scramble (input) {
  let out = ''
  for (let i = 0; i < input.length; i++) out = i % 2 === 0 ? out + input.charAt(i) : input.charAt(i) + out
  return out
}

function md5 (text) {
  return require('crypto').createHash('md5').update(text).digest('hex')
}

function hashName (name) {
  return md5(scramble(HASH_KEY + name))
}

function addressFor (folder, name, deploy = state.deploy) {
  return `${CONTENT_URL}/${deploy || '{version}'}/${folder.replace(/^\/|\/$/g, '')}/${hashName(name)}`
}

function download (name, content) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  a.download = name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
}

async function loadRaw (id) {
  if (rawPacks.has(id)) return rawPacks.get(id)
  const promise = items.fetchPack(state.deploy, id).catch(err => {
    rawPacks.delete(id)
    throw err
  })
  rawPacks.set(id, promise)
  return promise
}

function entriesOf (pack) {
  if (!pack || typeof pack !== 'object') return []
  return Array.isArray(pack) ? pack : Object.values(pack)
}

function findRaw (pack, id) {
  if (!pack) return null
  if (!Array.isArray(pack) && pack[id] && typeof pack[id] === 'object') return pack[id]
  return entriesOf(pack).find(e => e && String(e.id) === String(id)) || null
}

function buildList () {
  const map = state.tab === 'den' ? items.den : items.clothing
  state.list = [...map.entries()].map(([id, v]) => ({
    id: Number(id),
    name: v.name || '',
    cost: v.cost || 0,
    currency: v.currency,
    members: !!v.members
  }))
}

function parseSearch (text) {
  const q = { ids: [], range: null, words: [] }
  for (const tok of text.toLowerCase().split(/\s+/).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(tok)
    if (range) q.range = [Number(range[1]), Number(range[2])]
    else if (/^\d+$/.test(tok)) q.ids.push(Number(tok))
    else q.words.push(tok)
  }
  return q
}

function applyFilters () {
  const q = parseSearch($('q').value)
  const min = $('fMin').value === '' ? null : Number($('fMin').value)
  const max = $('fMax').value === '' ? null : Number($('fMax').value)
  const named = $('fNamed').checked

  state.filtered = state.list.filter(it => {
    if (named && !it.name) return false
    if (state.members === 'm' && !it.members) return false
    if (state.members === 'f' && it.members) return false
    if (state.currency !== 'all' && it.currency !== state.currency) return false
    if (min !== null && it.cost < min) return false
    if (max !== null && it.cost > max) return false
    if (q.range && (it.cost < q.range[0] || it.cost > q.range[1])) return false
    if (q.ids.length && !q.ids.includes(it.id) && !q.ids.some(n => it.name.toLowerCase().includes(String(n)))) return false
    if (q.words.length) {
      const name = it.name.toLowerCase()
      if (!q.words.every(w => name.includes(w))) return false
    }
    return true
  })

  const { key, dir } = state.sort
  state.filtered.sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    if (typeof av === 'string') return av.localeCompare(bv) * dir || a.id - b.id
    return ((av > bv) - (av < bv)) * dir || a.id - b.id
  })

  const total = state.list.length
  const members = state.filtered.filter(i => i.members).length
  $('count').textContent = `${state.filtered.length.toLocaleString()} of ${total.toLocaleString()} ${state.tab === 'den' ? 'den items' : 'clothing items'} · ${members.toLocaleString()} members-only`
  document.querySelectorAll('#thead span[data-sort]').forEach(s => {
    const on = s.dataset.sort === key
    s.classList.toggle('sorted', on)
    s.textContent = s.textContent.replace(/ [▲▼]$/, '') + (on ? (dir > 0 ? ' ▲' : ' ▼') : '')
  })

  $('spacerY').style.height = state.filtered.length * ROW_H + 'px'
  $('rows').scrollTop = 0
  renderRows(true)
}

function renderRows (force) {
  const box = $('rows')
  const first = Math.max(0, Math.floor(box.scrollTop / ROW_H) - 10)
  const last = Math.min(state.filtered.length, Math.ceil((box.scrollTop + box.clientHeight) / ROW_H) + 10)
  if (!force && renderRows.range && renderRows.range[0] === first && renderRows.range[1] === last) return
  renderRows.range = [first, last]

  const spacer = $('spacerY')
  spacer.innerHTML = ''
  if (!state.filtered.length) {
    spacer.innerHTML = `<div class="empty">${state.list.length ? 'No items match these filters.' : 'No items loaded yet.'}</div>`
    spacer.style.height = 'auto'
    return
  }

  const frag = document.createDocumentFragment()
  for (let i = first; i < last; i++) {
    const it = state.filtered[i]
    const row = document.createElement('div')
    row.className = 'trow' + (state.selected === it.id ? ' sel' : '')
    row.style.top = i * ROW_H + 'px'
    row.dataset.id = it.id
    row.innerHTML = `
      <span class="id">${it.id}</span>
      <span class="nm${it.name ? '' : ' none'}">${escapeHtml(it.name || 'No name')}</span>
      <span class="cost">${it.cost ? it.cost.toLocaleString() : '—'}${it.cost ? `<span class="cur ${it.currency}" title="${it.currency}"></span>` : ''}</span>
      <span>${it.members ? '<span class="pill m">Members</span>' : '<span class="pill f">Free</span>'}</span>
      <span></span>`
    frag.appendChild(row)
  }
  spacer.appendChild(frag)
}

function resolveString (strings, value) {
  if (!strings || value === undefined || value === null) return null
  const s = Array.isArray(strings) ? strings[value] : strings[value]
  return typeof s === 'string' ? s : null
}

function rawTable (raw, strings) {
  const rows = Object.entries(raw).map(([k, v]) => {
    const text = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
    const res = /StrId$/i.test(k) ? resolveString(strings, v) : null
    return `<tr><td class="k">${escapeHtml(k)}</td><td class="v" data-copy="${escapeHtml(text)}">${escapeHtml(text)}${res ? `<span class="res">“${escapeHtml(res)}”</span>` : ''}</td></tr>`
  })
  return `<table>${rows.join('')}</table>`
}

async function showDetail (id) {
  state.selected = id
  renderRows(true)
  const it = state.list.find(i => i.id === id)
  if (!it) return
  const pack = state.tab === 'den' ? PACKS.den : PACKS.clothing
  const packUrl = addressFor('defPacks', pack.id)
  const kind = state.tab === 'den' ? 'den item' : 'clothing item'

  $('detail').innerHTML = `
    <div class="dtitle">${escapeHtml(it.name || 'No name')}</div>
    <div class="pills">
      <span class="pill k">${kind}</span>
      ${it.members ? '<span class="pill m">Members only</span>' : '<span class="pill f">Free</span>'}
      ${it.cost ? `<span class="pill k">${it.currency}</span>` : ''}
    </div>
    <div class="stat">
      <div><div class="v">${it.id}</div><div class="k">Item id</div></div>
      <div><div class="v">${it.cost ? it.cost.toLocaleString() : '—'}</div><div class="k">Listed value</div></div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn small" data-copy="${it.id}">Copy id</button>
      <button class="btn small" data-copy="${escapeHtml(it.name)}">Copy name</button>
      <button class="btn small" id="copyRaw" disabled>Copy raw data</button>
    </div>

    <h3>Data file address</h3>
    <div class="addr"><code>${escapeHtml(packUrl)}</code><button class="btn small" data-copy="${escapeHtml(packUrl)}">Copy</button></div>
    <div class="hint">This ${kind} is defined in defpack <b>${pack.id}</b> (${pack.label}). The address is the pack id hashed with the game's key.</div>

    <h3>Raw game data</h3>
    <div id="rawBox" class="hint">Loading…</div>`

  try {
    const [raw, strings] = await Promise.all([loadRaw(pack.id), loadRaw(PACKS.strings.id)])
    if (state.selected !== id) return
    const entry = findRaw(raw, id)
    const box = $('rawBox')
    if (!entry) {
      box.textContent = 'Not found in the raw pack.'
      return
    }
    box.className = ''
    box.innerHTML = rawTable(entry, strings) + '<div class="hint">Click a value to copy it. Fields ending in StrId are looked up in the text strings pack (10230).</div>'
    const btn = $('copyRaw')
    btn.disabled = false
    btn.addEventListener('click', () => copy(JSON.stringify(entry, null, 2), 'Copied raw data'))
  } catch (err) {
    if (state.selected === id) $('rawBox').textContent = `Couldn't download raw data: ${err.message}`
  }
}

function setTab (tab) {
  state.tab = tab
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab))
  $('browsePage').classList.toggle('hidden', !(tab === 'clothing' || tab === 'den'))
  $('packsPage').classList.toggle('hidden', tab !== 'packs')
  $('urlPage').classList.toggle('hidden', tab !== 'url')
  if (tab === 'clothing' || tab === 'den') {
    state.selected = null
    $('detail').innerHTML = '<div class="placeholder">Select an item to see its details,<br>raw game data and file addresses.</div>'
    if (items && items.ready) {
      buildList()
      applyFilters()
    }
  }
  if (tab === 'url') updateUrl()
}

function packSummary (pack) {
  const entries = entriesOf(pack)
  const objects = entries.filter(e => e && typeof e === 'object')
  const keys = new Set()
  objects.slice(0, 200).forEach(o => Object.keys(o).forEach(k => keys.add(k)))
  return { entries: entries.length, objects: objects.length, keys: [...keys] }
}

function withNames (value, strings) {
  if (!strings || !value || typeof value !== 'object' || Array.isArray(value)) return value
  const key = Object.keys(value).find(k => /StrId$/i.test(k))
  const name = key ? resolveString(strings, value[key]) : null
  return name ? { _name: name, ...value } : value
}

function renderPackJson () {
  if (!currentPack) return
  const f = $('packFilter').value.toLowerCase().trim()
  let entries = Array.isArray(currentPack.data)
    ? currentPack.data.map((v, i) => [i, v])
    : Object.entries(currentPack.data || {})
  entries = entries.map(([k, v]) => [k, withNames(v, currentPack.strings)])
  if (f) entries = entries.filter(([k, v]) => `${k} ${JSON.stringify(v)}`.toLowerCase().includes(f))
  const shown = entries.slice(0, 300)
  const obj = Object.fromEntries(shown)
  const note = currentPack.strings && entries.some(([, v]) => v && v._name) ? '// _name is looked up from the text strings pack\n' : ''
  $('packJson').textContent = note + (entries.length > 300 ? `// showing 300 of ${entries.length} matching entries\n` : `// ${entries.length} matching entries\n`) +
    JSON.stringify(obj, null, 2)
}

async function loadPack () {
  const id = $('packId').value.trim()
  if (!id) return
  $('packUrl').textContent = addressFor('defPacks', id)
  $('packJson').textContent = 'Downloading…'
  $('packSummary').innerHTML = ''
  $('savePack').disabled = true
  try {
    const [data, strings] = await Promise.all([
      loadRaw(id),
      id === PACKS.strings.id ? null : loadRaw(PACKS.strings.id).catch(() => null)
    ])
    currentPack = { id, data, strings }
    const s = packSummary(data)
    $('packSummary').innerHTML = `
      <div><div class="v">${s.entries.toLocaleString()}</div><div class="k">entries</div></div>
      <div><div class="v">${s.objects ? s.keys.length : '—'}</div><div class="k">fields per entry</div></div>
      <div style="flex:1;min-width:200px"><div class="v" style="font-weight:400;font-size:11px">${escapeHtml(s.keys.slice(0, 30).join(', ') || 'plain values')}</div><div class="k">field names</div></div>`
    $('savePack').disabled = false
    renderPackJson()
  } catch (err) {
    currentPack = null
    $('packJson').textContent = `Couldn't load pack ${id}: ${err.message}`
  }
}

async function checkKnownPacks () {
  const button = $('scanPacks')
  const output = $('activePacks')
  const status = $('scanStatus')
  if (!state.deploy) {
    status.textContent = 'Game version is not ready yet.'
    return
  }

  button.disabled = true
  output.replaceChildren()
  status.textContent = `Checking ${KNOWN_PACKS.length} known packs in version ${state.deploy}…`
  const results = []
  for (let offset = 0; offset < KNOWN_PACKS.length; offset += 4) {
    const batch = KNOWN_PACKS.slice(offset, offset + 4)
    const batchResults = await Promise.all(batch.map(async pack => {
      try {
        const data = await loadRaw(pack.id)
        return { pack, ok: true, summary: packSummary(data) }
      } catch (error) {
        return { pack, ok: false, error: error.message }
      }
    }))
    results.push(...batchResults)
    status.textContent = `Checked ${Math.min(offset + batch.length, KNOWN_PACKS.length)} of ${KNOWN_PACKS.length} known packs…`
  }

  for (const result of results) {
    const row = document.createElement('div')
    row.className = 'pack-result'
    const label = document.createElement('span')
    label.textContent = `${result.pack.label} (${result.pack.id})`
    const detail = document.createElement('span')
    detail.className = result.ok ? 'pack-active' : 'pack-missing'
    detail.textContent = result.ok
      ? `Available · ${result.summary.entries.toLocaleString()} entries · ${result.summary.keys.length} fields`
      : 'Unavailable in this version or could not be decoded'
    row.append(label, detail)
    if (result.ok) {
      const open = document.createElement('button')
      open.className = 'btn small'
      open.textContent = 'Open'
      open.addEventListener('click', () => {
        $('packId').value = result.pack.id
        loadPack()
      })
      row.appendChild(open)
    }
    output.appendChild(row)
  }

  const active = results.filter(result => result.ok).length
  status.textContent = `Found ${active} of ${results.length} known packs in version ${state.deploy}.`
  button.disabled = false
}

async function scanDefpackRange () {
  const button = $('scanRange')
  const output = $('rangeScanResults')
  const status = $('rangeScanStatus')
  const start = Number($('scanStart').value)
  const end = Number($('scanEnd').value)
  const count = end - start + 1

  if (!state.deploy) {
    status.textContent = 'Game version is not ready yet.'
    return
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
    status.textContent = 'Enter a valid range of positive whole-number IDs.'
    return
  }
  if (count > 300) {
    status.textContent = 'Choose a range of 300 IDs or fewer.'
    return
  }

  button.disabled = true
  output.replaceChildren()
  const found = []
  const ids = Array.from({ length: count }, (_, index) => start + index)
  status.textContent = `Scanning ${count} IDs in deploy version ${state.deploy}…`

  for (let offset = 0; offset < ids.length; offset += 4) {
    const batch = ids.slice(offset, offset + 4)
    const results = await Promise.all(batch.map(async id => {
      try {
        const data = await loadRaw(String(id))
        return { id, summary: packSummary(data) }
      } catch (_) {
        return null
      }
    }))
    found.push(...results.filter(Boolean))
    const checked = Math.min(offset + batch.length, count)
    status.textContent = `Scanned ${checked} of ${count} IDs… found ${found.length} decodable packs.`
  }

  found.forEach(result => {
    const row = document.createElement('div')
    row.className = 'pack-result'
    const label = document.createElement('span')
    label.textContent = `Defpack ${result.id}`
    const detail = document.createElement('span')
    detail.className = 'pack-active'
    detail.textContent = `Available · ${result.summary.entries.toLocaleString()} entries · ${result.summary.keys.length} fields`
    const open = document.createElement('button')
    open.className = 'btn small'
    open.textContent = 'Open'
    open.addEventListener('click', () => {
      $('packId').value = result.id
      loadPack()
    })
    row.append(label, detail, open)
    output.appendChild(row)
  })

  status.textContent = `Scanned ${count} IDs in deploy version ${state.deploy}. Found ${found.length} decodable defpacks.`
  if (!found.length) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'No decodable defpacks found in this range.'
    output.appendChild(empty)
  }
  button.disabled = false
}

function updateUrl () {
  const deploy = $('uDeploy').value.trim() || '{version}'
  const folder = $('uFolder').value.trim()
  const file = $('uFile').value
  const mixed = HASH_KEY + file
  const scrambled = scramble(mixed)
  const hash = md5(scrambled)
  $('uUrl').textContent = `${CONTENT_URL}/${deploy}/${folder.replace(/^\/|\/$/g, '')}/${hash}`
  $('uSteps').innerHTML = `
    <span class="k">1. Key + name</span><span class="v">${escapeHtml(mixed)}</span>
    <span class="k">2. Scrambled</span><span class="v">${escapeHtml(scrambled)}</span>
    <span class="k">3. MD5</span><span class="v">${hash}</span>`
}

function waitForJam () {
  return new Promise(resolve => {
    if (window.jam && window.jam.application) return resolve(window.jam)
    const t = setInterval(() => {
      if (window.jam && window.jam.application) { clearInterval(t); resolve(window.jam) }
    }, 100)
  })
}

function bindSeg (id, key) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button')
    if (!b) return
    state[key] = b.dataset.v
    $(id).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b))
    applyFilters()
  })
}

document.addEventListener('DOMContentLoaded', async () => {
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('button')
    if (b) setTab(b.dataset.tab)
  })

  let t = null
  $('q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(applyFilters, 100) })
  ;['fMin', 'fMax', 'fNamed'].forEach(id => $(id).addEventListener('input', applyFilters))
  bindSeg('fMembers', 'members')
  bindSeg('fCurrency', 'currency')

  $('thead').addEventListener('click', e => {
    const s = e.target.closest('span[data-sort]')
    if (!s) return
    const key = s.dataset.sort
    state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : (key === 'name' || key === 'id' ? 1 : -1) }
    applyFilters()
  })

  $('rows').addEventListener('scroll', () => renderRows(false))
  window.addEventListener('resize', () => renderRows(true))
  $('rows').addEventListener('click', e => {
    const row = e.target.closest('.trow')
    if (row) showDetail(Number(row.dataset.id))
  })

  document.addEventListener('click', e => {
    const c = e.target.closest('[data-copy]')
    if (c) return copy(c.dataset.copy, `Copied ${String(c.dataset.copy).slice(0, 40)}`)
    const f = e.target.closest('[data-copy-from]')
    if (f) copy($(f.dataset.copyFrom).textContent)
  })

  document.addEventListener('keydown', e => {
    if (!(state.tab === 'clothing' || state.tab === 'den') || /INPUT|SELECT/.test(document.activeElement.tagName)) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('q').focus() }
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('q').focus(); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    let i = state.filtered.findIndex(x => x.id === state.selected)
    i = Math.max(0, Math.min(state.filtered.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
    const it = state.filtered[i]
    if (!it) return
    const box = $('rows')
    if (i * ROW_H < box.scrollTop) box.scrollTop = i * ROW_H
    if ((i + 1) * ROW_H > box.scrollTop + box.clientHeight) box.scrollTop = (i + 1) * ROW_H - box.clientHeight
    showDetail(it.id)
  })

  KNOWN_PACKS.forEach(({ id, label }) => {
    const b = document.createElement('button')
    b.className = 'btn small'
    b.textContent = `${label} (${id})`
    b.addEventListener('click', () => { $('packId').value = id; loadPack() })
    $('quickPacks').appendChild(b)
  })
  $('scanPacks').addEventListener('click', checkKnownPacks)
  $('scanRange').addEventListener('click', scanDefpackRange)
  $('scanEnd').addEventListener('keydown', e => { if (e.key === 'Enter') scanDefpackRange() })
  $('loadPack').addEventListener('click', loadPack)
  $('packId').addEventListener('keydown', e => { if (e.key === 'Enter') loadPack() })
  $('packFilter').addEventListener('input', renderPackJson)
  $('savePack').addEventListener('click', () => {
    if (currentPack) download(`defpack-${currentPack.id}-${state.deploy}.json`, JSON.stringify(currentPack.data, null, 2))
  })

  ;[['defPacks', '1000'], ['defPacks', '10230'], ['roomDefs/<map>', '<file>.xroom']].forEach(([folder, file]) => {
    const b = document.createElement('button')
    b.className = 'btn small'
    b.textContent = `${folder} / ${file}`
    b.addEventListener('click', () => { $('uFolder').value = folder; $('uFile').value = file; updateUrl() })
    $('quickFolders').appendChild(b)
  })
  ;['uDeploy', 'uFolder', 'uFile'].forEach(id => $(id).addEventListener('input', updateUrl))

  $('refresh').addEventListener('click', async () => {
    if (!items || !items.refresh) return toast('Update JR to use this')
    const btn = $('refresh')
    btn.disabled = true
    setStatus('Checking for a new game version…')
    try {
      const updated = await items.refresh()
      rawPacks.clear()
      state.deploy = items.deployVersion
      $('deploy').textContent = `game version ${state.deploy}`
      $('uDeploy').value = state.deploy
      updateUrl()
      setStatus(`${(items.clothing.size + items.den.size).toLocaleString()} items · version ${state.deploy}`, 'ok')
      toast(updated ? `Updated to game version ${state.deploy}` : 'Already up to date')
      if (state.tab === 'clothing' || state.tab === 'den') setTab(state.tab)
    } catch (err) {
      setStatus(`Update check failed: ${err.message}`, 'err')
    }
    btn.disabled = false
  })

  const jam = await waitForJam()
  items = jam.application.items
  if (!items) {
    setStatus('Item database not available. Update JR.', 'err')
    return
  }

  setStatus('Loading item lists…')
  try {
    await items.load()
    state.deploy = items.deployVersion
    $('deploy').textContent = `game version ${state.deploy}`
    $('uDeploy').value = state.deploy
    setStatus(`${(items.clothing.size + items.den.size).toLocaleString()} items · version ${state.deploy}`, 'ok')
    updateUrl()
    buildList()
    applyFilters()
  } catch (err) {
    setStatus(`Couldn't load items: ${err.message}`, 'err')
  }
})
