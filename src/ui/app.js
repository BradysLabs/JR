'use strict'

/* JR profile window. */

const { ipcRenderer, shell } = require('electron')
const path = require('path')

const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
const profileId = new URLSearchParams(location.search).get('profile')
const info = ipcRenderer.sendSync('jr:profile-info', profileId)
if (!info.ok) { document.body.textContent = info.error; throw new Error(info.error) }

const engine = require(path.join(info.root, 'src', 'ui', 'engine.js'))(info)
window.jr = engine // handy in DevTools
const themes = require(path.join(info.root, 'src', 'ui', 'themes.js'))
themes.applyTheme(document, engine.settings.theme)
const worthTools = require(path.join(info.root, 'src', 'worth', 'match.js'))
const valueTools = require(path.join(info.root, 'src', 'worth', 'value.js'))
let worthByName = new Map()
// Diamonds per unit (collar grades, BL, RIMs, Betas...), worked out from the wiki itself.
let worthRates = new Map()
try {
  const worthItems = JSON.parse(require('fs').readFileSync(path.join(info.root, 'data', 'worth', 'values.json'), 'utf8')).items || []
  worthByName = worthTools.indexWorth(worthItems)
  worthRates = valueTools.buildRates(worthItems.map(it => ({ p: it.page, v: it.variant, g: it.grade, t: it.raw })))
} catch (_) {}

const inkFor = (hex) => (['#ededee', '#d9a441', '#ffffff'].includes(String(hex).toLowerCase()) ? '#0b0b0c' : '#ffffff')
const time = (t) => new Date(t).toTimeString().slice(0, 8)

function toast (text, isError) {
  const t = el('div', 'toast' + (isError ? ' error' : ''), text)
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 4200)
}
const attempt = (fn) => async (...args) => { try { await fn(...args) } catch (e) { toast(e.message, true) } }

/* --------------------------------------------------------------- chrome */

document.title = `JR · ${info.profile.name}`
$('tbProfile').textContent = `${info.profile.name} · v${info.version}`
$('railAvatar').textContent = info.profile.name[0].toUpperCase()
$('railAvatar').style.background = info.profile.color
$('railAvatar').style.color = inkFor(info.profile.color)
$('railAvatar').title = `Profile: ${info.profile.name}`
document.querySelectorAll('[data-win]').forEach(b => { b.onclick = () => ipcRenderer.send('win', b.dataset.win) })
$('railLogo').onclick = () => ipcRenderer.invoke('picker:show')

const PAGES = ['home', 'plugins', 'trading', 'logs', 'settings']
let page = 'home'
document.querySelectorAll('.rail-btn').forEach((b, i) => { b.style.top = (62 + i * 50) + 'px'; b.onclick = () => go(b.dataset.page) })
function go (next) {
  page = next
  PAGES.forEach(p => $('page-' + p).classList.toggle('hidden', p !== next))
  document.querySelectorAll('.rail-btn').forEach(b => b.classList.toggle('on', b.dataset.page === next))
  $('railMarker').style.top = (62 + PAGES.indexOf(next) * 50) + 'px'
  if (next === 'plugins') renderPlugins()
  if (next === 'logs') renderLogs()
  if (next === 'settings') renderSettings()
  if (next === 'home') renderPins()
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.shiftKey && /^[1-5]$/.test(e.key)) { e.preventDefault(); go(PAGES[Number(e.key) - 1]) }
  if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); go('home'); $('search').focus(); $('search').select() }
  if (e.key === 'F12') ipcRenderer.send('win', 'devtools')
})

function renderStatus () {
  const connected = engine.dispatch.connected
  const playing = engine.gameRunning
  const dot = $('statusDot')
  dot.className = 'dot' + (connected ? ' on' : playing ? ' wait' : '')
  $('statusText').textContent = connected ? 'Connected' : playing ? 'Waiting for the game…' : 'Not connected'
  const room = engine.dispatch.getState('roomName')
  const bits = []
  if (connected && engine.serverName) bits.push(engine.serverName)
  if (connected && room) bits.push(engine.application.streamingMode.mask(prettyRoom(room)))
  bits.push(`${engine.host.list().length} plugins`)
  $('statusDetail').textContent = '· ' + bits.join(' · ')
  $('playBtn').classList.toggle('playing', playing)
  $('playLabel').textContent = playing ? 'Playing' : 'Play'
  // Discord Rich Presence (the room is left out in streaming mode).
  const presenceRoom = connected && room && !engine.application.streamingMode.enabled ? prettyRoom(room) : undefined
  ipcRenderer.send('presence', { connected, playing, room: presenceRoom })
}
function prettyRoom (name) {
  if (/^den/i.test(name)) return 'Den'
  return String(name).split('.')[0].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
engine.events.on('status', renderStatus)
engine.events.on('state', renderStatus)
engine.events.on('open-url', (url) => ipcRenderer.invoke('open-url', url))

/* ----------------------------------------------------------------- home */

$('playBtn').onclick = attempt(async () => {
  if (engine.gameRunning) { toast('Animal Jam is already open.'); return }
  $('playLabel').textContent = 'Opening…'
  await engine.play()
})
$('openLogs').onclick = () => go('logs')
$('homeCustomize').onclick = () => { go('settings'); setTimeout(() => { const g = $('homeSettings'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 50) }

/** Applies the Home screen options from Settings. */
function renderHome () {
  const s = engine.settings
  const greeting = String(s.homeGreeting || '').trim() || 'What do you want to do?'
  $('homeGreeting').textContent = greeting.replace(/\{name\}/gi, info.profile.name)
  $('homeSearch').classList.toggle('hidden', !s.homeShowSearch)
  $('homePlay').classList.toggle('hidden', !s.homeShowPlay)
  $('homePins').classList.toggle('hidden', !s.homeShowPins)
  $('homeTicker').classList.toggle('hidden', !s.homeShowTicker)
  $('home').dataset.bg = s.homeBackground || 'none'
}
renderHome()

function renderPins () {
  const box = $('pins')
  box.innerHTML = ''
  const list = engine.host.list()
  const pins = engine.settings.pinned.map(id => list.find(p => p.id === id)).filter(p => p && (p.status === 'ready' || p.status === 'running'))
  if (!pins.length) { box.appendChild(el('div', 'empty', 'Star plugins in Plugins to pin them here.')); return }
  for (const p of pins) {
    const c = el('button', 'chip', p.name)
    c.onclick = attempt(() => usePlugin(p))
    box.appendChild(c)
  }
}

function setTicker (e) {
  $('tickT').textContent = time(e.t)
  $('tickM').textContent = engine.application.streamingMode.mask(e.message)
}

// Search: plugins and console commands.
let results = []
let sel = 0
function search (q) {
  q = q.trim().toLowerCase()
  if (!q) return []
  const out = []
  for (const p of engine.host.list()) {
    if (!p.manifest && !p.name) continue
    const hay = `${p.name} ${p.description || ''} ${p.category || ''}`.toLowerCase()
    if (hay.includes(q)) out.push({ kind: 'PLUGIN', title: p.name, sub: p.description || '', run: () => usePlugin(p) })
  }
  for (const c of engine.dispatch.commands.values()) {
    if (`${c.name} ${c.description}`.toLowerCase().includes(q)) out.push({ kind: 'COMMAND', title: c.name, sub: c.description, run: () => { go('logs'); $('cmd').value = c.name + ' '; $('cmd').focus() } })
  }
  for (const p of PAGES) if (p.includes(q)) out.push({ kind: 'PAGE', title: p[0].toUpperCase() + p.slice(1), sub: '', run: () => go(p) })
  return out.slice(0, 8)
}
function renderResults () {
  const box = $('results')
  box.innerHTML = ''
  box.classList.toggle('hidden', !results.length)
  results.forEach((r, i) => {
    const b = el('button', 'result' + (i === sel ? ' sel' : ''))
    const text = el('div')
    text.append(el('div', null, r.title))
    if (r.sub) text.append(el('div', 'sub', r.sub))
    b.append(text, el('span', 'kind', r.kind))
    b.onmousedown = (e) => { e.preventDefault(); pick(i) }
    box.appendChild(b)
  })
}
function pick (i) {
  const r = results[i]
  if (!r) return
  $('search').value = ''
  results = []
  renderResults()
  attempt(r.run)()
}
$('search').oninput = () => { results = search($('search').value); sel = 0; renderResults() }
$('search').onblur = () => setTimeout(() => { results = []; renderResults() }, 100)
$('search').onkeydown = (e) => {
  if (e.key === 'ArrowDown') { sel = Math.min(results.length - 1, sel + 1); renderResults(); e.preventDefault() }
  if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); renderResults(); e.preventDefault() }
  if (e.key === 'Enter') pick(sel)
  if (e.key === 'Escape') { $('search').value = ''; results = []; renderResults() }
}

/* -------------------------------------------------------------- plugins */

let cat = 'All'
let pluginQuery = ''
const STATUS_TEXT = { running: 'On', ready: '', 'needs-approval': 'Needs your OK', changed: 'Changed, needs your OK', off: 'Off', error: 'Error' }

async function usePlugin (p) {
  if (p.status === 'ready') return engine.openPlugin(p.id)
  if (p.status === 'running') { go('plugins'); toast(`${p.name} runs in the background.`); return }
  go('plugins')
}

function renderPlugins () {
  const list = engine.host.list().sort((a, b) => a.name.localeCompare(b.name))
  const waiting = list.filter(p => p.status === 'needs-approval' || p.status === 'changed')
  $('pluginCount').textContent = `${list.length} installed`
  const cats = ['All', ...new Set(list.map(p => p.category || 'Other'))].filter((c, i, a) => a.indexOf(c) === i)
  if (!cats.includes(cat)) cat = 'All'
  const catBox = $('cats')
  catBox.innerHTML = ''
  for (const c of cats.sort((a, b) => (a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b)))) {
    const b = el('button', c === cat ? 'on' : '', c)
    b.onclick = () => { cat = c; renderPlugins() }
    catBox.appendChild(b)
  }
  const grid = $('grid')
  grid.innerHTML = ''
  const open = engine.openWindows
  const shown = [...waiting, ...list.filter(p => !waiting.includes(p))]
    .filter(p => cat === 'All' || (p.category || 'Other') === cat)
    .filter(p => !pluginQuery || `${p.name} ${p.description} ${p.author}`.toLowerCase().includes(pluginQuery))
  if (!shown.length) grid.appendChild(el('div', 'empty-page', 'No plugins here.'))
  for (const p of shown) {
    const isWaiting = p.status === 'needs-approval' || p.status === 'changed'
    const card = el('div', 'pcard ' + p.status + (isWaiting ? ' waiting' : ''))
    const top = el('div', 'top')
    if (open.has(p.id) || p.status === 'running') { const live = el('div', 'live'); live.title = open.has(p.id) ? 'Window open' : 'Running'; top.appendChild(live) }
    top.append(el('div', 'name', p.name), el('div', 'cat', String(p.category || 'Other').toUpperCase()))
    card.appendChild(top)
    if (isWaiting) {
      card.appendChild(el('div', 'desc', `${p.status === 'changed' ? 'This plugin changed since you allowed it.' : 'New plugin' + (p.author ? ` by ${p.author}` : '')}. Plugins can send packets as you, so only allow ones you trust.`))
    } else if (p.status === 'error') {
      card.appendChild(el('div', 'desc', p.errors.join(' ') || 'This plugin has a problem.'))
    } else {
      card.appendChild(el('div', 'desc', p.description || ''))
    }
    const row = el('div', 'row')
    const btn = (label, primary, fn) => { const b = el('button', 'btn' + (primary ? ' primary' : ''), label); b.onclick = (e) => { e.stopPropagation(); attempt(fn)() }; row.appendChild(b) }
    if (isWaiting) {
      btn('Allow', true, () => { engine.host.approve(p.id); renderPlugins(); renderStatus() })
      btn('Keep off', false, () => { engine.host.turnOff(p.id); renderPlugins() })
    } else if (p.status === 'off') {
      btn('Turn on', false, () => { engine.host.turnOn(p.id); renderPlugins() })
    } else if (p.status === 'running') {
      row.appendChild(el('span', 'state', 'Runs in the background'))
      btn('Turn off', false, () => { engine.host.turnOff(p.id); renderPlugins() })
    } else if (p.status === 'ready') {
      btn(open.has(p.id) ? 'Show' : 'Open', false, () => engine.openPlugin(p.id))
      if (!p.builtIn) btn('Turn off', false, () => { engine.host.turnOff(p.id); renderPlugins() })
    }
    card.appendChild(row)
    if (!isWaiting && p.status !== 'error') {
      const pinned = engine.settings.pinned.includes(p.id)
      const star = el('button', 'star' + (pinned ? ' on' : ''))
      star.title = pinned ? 'Unpin from Home' : 'Pin to Home'
      star.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="${pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`
      star.onclick = (e) => {
        e.stopPropagation()
        const pins = engine.settings.pinned.filter(x => x !== p.id)
        if (!pinned) pins.push(p.id)
        engine.updateSettings({ pinned: pins })
        renderPlugins()
      }
      card.appendChild(star)
    }
    if (p.status === 'ready') { card.style.cursor = 'pointer'; card.onclick = attempt(() => engine.openPlugin(p.id)) }
    grid.appendChild(card)
  }
  const badge = $('pluginBadge')
  badge.classList.toggle('hidden', !waiting.length)
  badge.textContent = waiting.length
}
$('pluginSearch').oninput = () => { pluginQuery = $('pluginSearch').value.trim().toLowerCase(); renderPlugins() }
$('reloadPlugins').onclick = attempt(() => {
  engine.host.load()
  renderPlugins(); renderStatus(); renderPins()
  toast('Plugins loaded again.')
})
$('pluginFolder').onclick = () => shell.openPath(info.userPlugins)
engine.events.on('plugins', () => { if (page === 'plugins') renderPlugins(); if (page === 'home') renderPins(); renderStatus() })

/* --------------------------------------------------------------- trading */

// Trade requests: %xt%ti%<room>%<code>%<user>%... The game's own layout:
// code 0 = request; offered items start 7 fields after the command:
// [clothing count][den count][pet count] then clothing (defId, color),
// den items (6 fields each) and pets (10 fields each).
const trade = { active: false, offered: [], mine: new Map() }
const ownClothingSlots = new Map()
const ownDenSlots = new Map()

// Your den items: %xt%di%<room>%<den>%<count>%<?>%, then per item
// invIdx, defId, ?, version, flag, text, number, text, [10 fields for mannequins], number.
function rememberOwnDenInventory (message) {
  const p = message && message.value
  if (!Array.isArray(p)) return
  const count = Math.max(0, Math.min(20000, Number(p[5]) || 0))
  let i = 7
  const next = new Map()
  for (let n = 0; n < count && i + 7 < p.length; n++) {
    const slot = String(p[i])
    const defId = Number(p[i + 1])
    i += 8
    const def = engine.items.getDenItem && engine.items.getDenItem(defId)
    if (def && def.specialType === 4) i += 10
    i += 1
    if (/^\d+$/.test(slot) && defId) next.set(slot, { defId })
  }
  ownDenSlots.clear()
  for (const [slot, item] of next) ownDenSlots.set(slot, item)
}
engine.dispatch.onMessage({ type: 'aj', message: 'di', callback: ({ message }) => rememberOwnDenInventory(message) })

function rememberOwnClothingInventory (message) {
  const p = message && message.value
  if (!Array.isArray(p) || p.length < 11) return
  const player = engine.dispatch.getState('player') || {}
  const ownName = String(player.username || player.userName || player.screenName || player.name || '').toLowerCase()
  if (!ownName || String(p[7] || '').toLowerCase() !== ownName) return

  const kind = Number(p[4])
  if (kind === 0) {
    const count = Math.max(0, Math.min(10000, Number(p[10]) || 0))
    const next = new Map()
    for (let i = 11, n = 0; n < count && i + 2 < p.length; n++, i += 5) {
      const [defId, invId, color] = p.slice(i, i + 3)
      if (/^\d+$/.test(String(defId)) && /^\d+$/.test(String(invId))) {
        next.set(String(invId), { defId: Number(defId), color: Number(color) >>> 0 })
      }
    }
    ownClothingSlots.clear()
    for (const [slot, item] of next) ownClothingSlots.set(slot, item)
    return
  }

  if (kind === 2) {
    const added = Math.max(0, Math.min(10000, Number(p[9]) || 0))
    const removed = Math.max(0, Math.min(10000, Number(p[10]) || 0))
    const color = Number(p[8]) >>> 0
    let i = 11
    for (let n = 0; n < added && i + 1 < p.length; n++, i += 2) {
      const slot = String(p[i]), rawDefId = String(p[i + 1])
      if (/^\d+$/.test(slot) && /^\d+$/.test(rawDefId)) ownClothingSlots.set(slot, { defId: Number(rawDefId), color })
    }
    for (let n = 0; n < removed && i < p.length; n++, i++) ownClothingSlots.delete(String(p[i]))
  }
}

function loadSavedOwnClothingInventory () {
  try {
    const file = path.join(info.dataDir, 'plugin-data', 'inventory-worth-capture', 'inventory.json')
    const saved = JSON.parse(require('fs').readFileSync(file, 'utf8'))
    for (const item of saved.items || []) ownClothingSlots.set(String(item.invId), { defId: Number(item.defId), color: Number(item.color) >>> 0 })
  } catch (_) {}
}
loadSavedOwnClothingInventory()
engine.dispatch.onMessage({ type: 'aj', message: 'il', callback: ({ message }) => rememberOwnClothingInventory(message) })

function parseTradeRequest (parts) {
  const obj = parts.slice(2) // obj[0] = 'ti'
  let i = 7
  const nClothing = Number(obj[i++]) || 0
  const nDen = Number(obj[i++]) || 0
  const nPets = Number(obj[i++]) || 0
  const offered = []
  for (let k = 0; k < nClothing; k++) { offered.push({ kind: 'clothing', id: obj[i], color: obj[i + 1] }); i += 2 }
  for (let k = 0; k < nDen; k++) { offered.push({ kind: 'den', id: obj[i] }); i += 6 }
  for (let k = 0; k < nPets; k++) { offered.push({ kind: 'pet', id: obj[i + 1] }); i += 10 }
  return { user: obj[3], wantsType: Number(obj[5]), offered }
}
function itemName (it) {
  if (it.kind === 'pet') return 'Pet'
  if (it.kind === 'other') return `Trade item type ${it.type}`
  if (it.kind === 'clothing' && it.id == null) return `Clothing item · slot ${it.slot}`
  const n = engine.items.name(it.id, it.kind)
  return n || `${it.kind === 'den' ? 'Den item' : 'Item'} #${it.id}`
}
function tradeRows (it) {
  if (!it || it.kind === 'pet' || it.kind === 'other' || it.id == null) return []
  if (it.kind !== 'clothing') return worthTools.rowsFor(worthByName, itemName(it), null)
  const definition = engine.items.getClothing(it.id)
  const item = definition ? { ...definition, id: Number(it.id) } : { id: Number(it.id), name: itemName(it) }
  return worthTools.rowsForGameItem(worthByName, item, it.color, engine.items.layerColors && engine.items.layerColors.bind(engine.items))
}
function tradeColor (it, matches = []) {
  if (it.kind !== 'clothing') return null
  const labels = [...new Set(matches.filter(row => row._wikiColorMatch).map(row => row.variant).filter(Boolean))]
  return labels.length === 1 ? { label: labels[0] } : null
}

function tradeMineItems () {
  return [...trade.mine.values()].map(({ type, slot, requested }) => withRequested(requested, (() => {
    if (type === 0) {
      const item = ownClothingSlots.get(String(slot))
      return item
        ? { kind: 'clothing', id: item.defId, color: item.color, slot }
        : { kind: 'clothing', id: null, color: null, slot }
    }
    if (type === 1) {
      const item = ownDenSlots.get(String(slot))
      return item ? { kind: 'den', id: item.defId, slot } : { kind: 'other', type, slot }
    }
    if (type === 3) return { kind: 'pet', slot }
    return { kind: 'other', type, slot }
  })()))
}
function withRequested (requested, item) { if (requested) item.requested = true; return item }

function addTradeListItems (box, items) {
  box.innerHTML = ''
  if (!items.length) { box.appendChild(el('div', 'state', 'Nothing yet')); return }
  const counts = new Map()
  for (const item of items) {
    const key = `${item.kind}:${item.id == null ? item.slot ?? item.type : item.id}:${Number(item.color) >>> 0}`
    const group = counts.get(key) || { item, count: 0 }
    group.count++
    counts.set(key, group)
  }
  for (const { item, count } of counts.values()) {
    const name = itemName(item)
    const row = el('div', 'titem')
    const detail = el('div', 'trade-worth')
    const matches = tradeRows(item)
    const color = tradeColor(item, matches)
    const image = worthTools.imageForRows(matches)
    if (image) {
      const picture = el('img', 'trade-img')
      picture.src = image; picture.alt = name; picture.loading = 'lazy'
      picture.onerror = () => picture.remove()
      row.appendChild(picture)
    }
    detail.append(el('span', 'trade-name', `${name}${color ? ` · ${color.label}` : ''}`))
    const value = item.kind === 'pet'
      ? 'Pet values are not matched yet'
      : item.kind === 'other'
        ? 'Item type is not mapped yet'
        : item.kind === 'clothing' && item.id == null
          ? 'Waiting for your inventory data'
          : worthTools.valueForRows(matches)
    detail.append(el('span', 'trade-value', value))
    const dia = diamondsFor(item)
    if (dia) detail.append(el('span', 'trade-dia', formatDiamonds({ min: dia.min * count, max: dia.max * count })))
    if (item.requested) detail.append(el('span', 'trade-tag', 'They asked for this'))
    row.append(detail, el('span', 'n', `×${count}`))
    box.appendChild(row)
  }
}

/** An item's worth in Diamonds (a range), using the wiki's own exchange rates. */
function diamondsFor (item) {
  if (!item || item.kind === 'pet' || item.kind === 'other' || item.id == null) return null
  const rows = tradeRows(item)
  const ranges = rows.map(row => valueTools.inDiamonds(row.raw || '', worthRates)).filter(Boolean)
  if (!ranges.length) return null
  const min = Math.min(...ranges.map(r => r.min))
  const max = Math.max(...ranges.map(r => r.max))
  // Too many different matches means JR isn't sure which one is yours.
  if (ranges.length > 1 && max > min * 3) return null
  return { min, max }
}
const blRate = () => worthRates.get('black long collar') || 425
function formatDiamonds (r) {
  const round = (n) => (n >= 100 ? Math.round(n / 5) * 5 : Math.round(n))
  const d = r.min === r.max || round(r.min) === round(r.max) ? `${round(r.min)}` : `${round(r.min)}–${round(r.max)}`
  const bl = ((r.min + r.max) / 2) / blRate()
  return `≈ ${d} Diamonds${bl >= 0.25 ? ` · ${bl >= 10 ? Math.round(bl) : Math.round(bl * 10) / 10} BL` : ''}`
}

function numericTradeValues (item) {
  if (!item || item.kind === 'pet' || item.kind === 'other' || item.id == null) return null
  const matches = tradeRows(item)
  if (worthTools.valueForRows(matches) === 'No exact wiki value') return null
  const choices = new Map()
  for (const row of matches) {
    for (const offer of row.offers || []) {
      if (!Number.isFinite(offer.min) || !Number.isFinite(offer.max) || !offer.unit || offer.knownUnit !== true || offer.atLeast || offer.bundle) continue
      if (!choices.has(offer.unit)) choices.set(offer.unit, new Map())
      choices.get(offer.unit).set(`${offer.min}:${offer.max}`, { min: offer.min, max: offer.max })
    }
  }
  const values = new Map()
  for (const [unit, ranges] of choices) if (ranges.size === 1) values.set(unit, [...ranges.values()][0])
  return values.size ? values : null
}

function assessTrade () {
  const mine = tradeMineItems()
  if (!trade.offered.length) return { kind: 'neutral', title: 'Nothing offered yet', detail: 'The other player hasn\u2019t offered any items.' }
  if (!mine.length) return { kind: 'neutral', title: 'Waiting for your side', detail: 'JR couldn\u2019t tell which of your items they asked for.' }
  if (mine.some(item => item.kind === 'clothing' && item.id == null)) return { kind: 'neutral', title: 'Waiting for inventory data', detail: 'Open your inventory in Animal Jam once so JR can see which item they asked for.' }

  const side = (items) => {
    let min = 0; let max = 0; const unknown = []
    for (const item of items) {
      const d = diamondsFor(item)
      if (d) { min += d.min; max += d.max } else unknown.push(itemName(item))
    }
    return { min, max, unknown }
  }
  const theirs = side(trade.offered)
  const yours = side(mine)
  if (!theirs.max || !yours.max) {
    const missing = [...theirs.unknown, ...yours.unknown]
    return { kind: 'neutral', title: 'Can\u2019t judge this trade yet', detail: `No wiki value JR can use for: ${missing.join(', ')}.` }
  }
  const t = (theirs.min + theirs.max) / 2
  const y = (yours.min + yours.max) / 2
  const ratio = t / y
  const kind = ratio >= 1.1 ? 'gain' : ratio <= 0.9 ? 'loss' : 'fair'
  const pct = Math.round(Math.abs(ratio - 1) * 100)
  const title = kind === 'gain' ? `In your favor (+${pct}%)` : kind === 'loss' ? `In their favor (−${Math.round((1 - ratio) * 100)}%)` : 'About even'
  let detail = `They offer ${formatDiamonds(theirs)}. You give ${formatDiamonds(yours)}.`
  const missing = [...theirs.unknown, ...yours.unknown]
  if (missing.length) detail += ` Not counted (no wiki value): ${missing.join(', ')}.`
  return { kind, title, detail, theirs: t, yours: y }
}

function renderTradeAssessment () {
  const { kind, title, detail, theirs, yours } = assessTrade()
  const box = $('tradeAssessment')
  box.className = `trade-assessment ${kind}`
  box.innerHTML = ''
  box.append(el('strong', 'assessment-label', title), el('span', 'assessment-detail', detail))
  // Favor scale: the marker leans toward whoever comes out ahead.
  const scale = el('div', 'trade-scale')
  const track = el('div', 'scale-track')
  const marker = el('div', 'scale-marker')
  const share = theirs && yours ? theirs / (theirs + yours) : 0.5
  marker.style.left = `${Math.max(3, Math.min(97, share * 100))}%`
  if (!theirs || !yours) scale.classList.add('unknown')
  track.append(el('div', 'scale-mid'), marker)
  scale.append(el('span', 'scale-end', 'Their favor'), track, el('span', 'scale-end', 'Your favor'))
  box.append(scale)
}

function parseTradeListUpdate (parts) {
  // Outgoing XT packets are %xt%o%ts%<room>%<removed count>...; the
  // leading room field is why the trade-list counts start at index 5.
  if (!trade.active || !Array.isArray(parts) || parts[2] !== 'o' || parts[3] !== 'ts' || parts.length < 6) return
  let i = 5
  const removed = Math.max(0, Math.min(1000, Number(parts[i++]) || 0))
  for (let n = 0; n < removed && i + 1 < parts.length; n++, i += 2) {
    const type = Number(parts[i]), slot = String(parts[i + 1])
    if (Number.isInteger(type) && /^\d+$/.test(slot)) trade.mine.delete(`${type}:${slot}`)
  }
  const added = Math.max(0, Math.min(1000, Number(parts[i++]) || 0))
  for (let n = 0; n < added && i + 1 < parts.length; n++, i += 2) {
    const type = Number(parts[i]), slot = String(parts[i + 1])
    if (!Number.isInteger(type) || !/^\d+$/.test(slot)) continue
    trade.mine.set(`${type}:${slot}`, { type, slot })
  }
  renderTrade()
}

function renderTrade () {
  $('tradeEmpty').classList.toggle('hidden', trade.active)
  $('trade').classList.toggle('hidden', !trade.active)
  if (!trade.active) return
  $('tradeTheirsLabel').textContent = `${engine.application.streamingMode.mask(trade.user || 'They').toUpperCase()} OFFERS`
  addTradeListItems($('tradeTheirs'), trade.offered)
  const what = ['a clothing item', 'a clothing item', 'a clothing item', 'a den item', 'a den item', 'a den item', 'a pet'][trade.wantsType] || 'one of your items'
  const mine = $('tradeMine')
  mine.innerHTML = ''
  const mineItems = tradeMineItems()
  if (!mineItems.length) mine.appendChild(el('div', 'trade-request', `They asked for ${what}.`))
  if (mineItems.length) addTradeListItems(mine, mineItems)
  renderTradeAssessment()
  $('tradeNote').textContent = trade.status || 'Listed values from the Animal Jam Item Worth Wiki (CC BY-SA). Comparisons use shared numeric units; estimates are not guarantees.'
}
engine.events.on('items', () => { if (trade.active) renderTrade() })
engine.dispatch.onMessage({
  type: 'aj',
  message: 'ti',
  callback: ({ message }) => {
    const parts = message.value
    const code = Number(parts[4])
    if (code === 0) {
      Object.assign(trade, { active: true, status: '', mine: new Map() }, parseTradeRequest(parts))
      // The request names the item of yours they want: type and inventory slot.
      const wantType = Number(parts[7])
      const wantSlot = String(parts[8] || '')
      const tradeType = wantType < 3 ? 0 : wantType < 6 ? 1 : 3
      if (/^\d+$/.test(wantSlot)) trade.mine.set(`${tradeType}:${wantSlot}`, { type: tradeType, slot: wantSlot, requested: true })
      engine.log({ type: 'notify', message: `Trade request from ${engine.application.streamingMode.mask(trade.user)} (${trade.offered.length} items).` })
      if (engine.settings.tradeHelper) go('trading')
    } else if (code === 1 && Number(parts[5]) !== 0) {
      trade.status = 'Trade done.'
    } else if (code >= 2) {
      trade.status = code === 6 ? 'Trade cancelled.' : 'Trade ended.'
      setTimeout(() => { trade.active = false; renderTrade() }, 4000)
    }
    renderTrade()
  }
})
engine.dispatch.onMessage({ type: 'connection', message: 'ts', callback: ({ message }) => parseTradeListUpdate(message.value) })
const tradeSwitch = $('tradeAuto')
const syncTradeSwitch = () => tradeSwitch.classList.toggle('on', !!engine.settings.tradeHelper)
tradeSwitch.onclick = () => { engine.updateSettings({ tradeHelper: !engine.settings.tradeHelper }); syncTradeSwitch() }
syncTradeSwitch()

/* ------------------------------------------------------------------ logs */

let logTab = 'console'
let netPaused = false
let netFilter = ''
document.querySelectorAll('#logTabs button').forEach(b => {
  b.onclick = () => {
    logTab = b.dataset.tab
    document.querySelectorAll('#logTabs button').forEach(x => x.classList.toggle('on', x === b))
    $('netFilter').classList.toggle('hidden', logTab !== 'network')
    $('pauseNet').classList.toggle('hidden', logTab !== 'network')
    renderLogs()
  }
})
$('pauseNet').classList.add('hidden')
$('pauseNet').onclick = () => { netPaused = !netPaused; $('pauseNet').textContent = netPaused ? 'Resume' : 'Pause'; if (!netPaused) renderLogs() }
$('netFilter').oninput = () => { netFilter = $('netFilter').value.trim().toLowerCase(); renderLogs() }
$('clearLogs').onclick = () => { if (logTab === 'console') engine.logs.length = 0; else engine.packets.length = 0; renderLogs() }

function logRow (e) {
  const r = el('div', 'lrow ' + e.type)
  r.append(el('span', 't', time(e.t)), el('span', 'lv', e.type === 'notify' ? 'info' : e.type === 'success' ? 'ok' : e.type), el('span', 'msg', engine.application.streamingMode.mask(e.message)))
  return r
}
function packetRow (p) {
  const r = el('div', `prow ${p.direction}${p.fromPlugin ? ' plugin' : ''}${p.blocked ? ' blocked' : ''}`)
  r.append(el('span', 'd', p.direction === 'in' ? '↓' : '↑'), el('span', 'ty', p.type || p.format), el('span', 'raw', engine.application.hideSecrets(engine.application.streamingMode.mask(p.raw))))
  r.title = p.raw.length > 400 ? p.raw.slice(0, 400) + '…' : p.raw
  return r
}
const packetMatches = (p) => !netFilter || (p.type || '').toLowerCase() === netFilter || p.raw.toLowerCase().includes(netFilter)
function renderLogs () {
  if (page !== 'logs') return
  const box = $('logbox')
  box.innerHTML = ''
  const frag = document.createDocumentFragment()
  if (logTab === 'console') engine.logs.slice(-400).forEach(e => frag.appendChild(logRow(e)))
  else engine.packets.filter(packetMatches).slice(-300).forEach(p => frag.appendChild(packetRow(p)))
  box.appendChild(frag)
  box.scrollTop = box.scrollHeight
}
function appendRow (row) {
  const box = $('logbox')
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40
  box.appendChild(row)
  while (box.childNodes.length > 500) box.removeChild(box.firstChild)
  if (atBottom) box.scrollTop = box.scrollHeight
}
engine.events.on('log', (e) => {
  setTicker(e)
  if (page === 'logs' && logTab === 'console') appendRow(logRow(e))
})
engine.events.on('packet', (p) => {
  if (page === 'logs' && logTab === 'network' && !netPaused && packetMatches(p)) appendRow(packetRow(p))
})
const cmdHistory = []
let hIdx = 0
$('cmd').onkeydown = attempt(async (e) => {
  if (e.key === 'ArrowUp' && cmdHistory.length) { hIdx = Math.max(0, hIdx - 1); $('cmd').value = cmdHistory[hIdx]; e.preventDefault(); return }
  if (e.key === 'ArrowDown' && cmdHistory.length) { hIdx = Math.min(cmdHistory.length, hIdx + 1); $('cmd').value = cmdHistory[hIdx] || ''; e.preventDefault(); return }
  if (e.key !== 'Enter') return
  const line = $('cmd').value.trim()
  if (!line) return
  $('cmd').value = ''
  cmdHistory.push(line); hIdx = cmdHistory.length
  if (line === 'help' || line === 'commands') {
    const list = [...engine.dispatch.commands.values()].map(c => `${c.name}${c.description ? ' – ' + c.description : ''}`)
    engine.log({ type: 'notify', message: list.length ? 'Commands:\n' + list.join('\n') : 'No commands yet. Plugins add them.' })
    return
  }
  engine.log({ type: 'notify', message: '› ' + line })
  if (!(await engine.dispatch.runCommand(line))) engine.log({ type: 'warn', message: `Unknown command "${line.split(' ')[0]}". Type help to see commands.` })
})

/* -------------------------------------------------------------- settings */

function renderSettings () {
  const s = engine.settings
  const box = $('settings')
  box.innerHTML = ''
  const group = (title, rows) => {
    const g = el('div', 'sgroup')
    g.appendChild(el('div', 'kicker', title))
    const b = el('div', 'sbox')
    rows.forEach(r => b.appendChild(r))
    g.appendChild(b)
    box.appendChild(g)
    return g
  }
  const row = (title, sub, control) => {
    const r = el('div', 'srow')
    const l = el('div', 'label')
    l.append(el('div', 'title', title))
    if (sub) l.append(el('div', 'sub', sub))
    r.append(l)
    if (control) r.append(control)
    return r
  }
  const toggle = (key, after) => {
    const b = el('button', 'switch' + (s[key] ? ' on' : ''))
    b.setAttribute('role', 'switch')
    b.onclick = () => { engine.updateSettings({ [key]: !engine.settings[key] }); b.classList.toggle('on', !!engine.settings[key]); if (after) after() }
    return b
  }
  const value = (text) => el('span', 'value', text)
  const button = (label, fn) => { const b = el('button', 'btn small', label); b.onclick = attempt(fn); return b }

  const select = (key, options, after) => {
    const sel = el('select', 'sselect')
    for (const [v, label] of options) { const o = el('option', null, label); o.value = v; if (s[key] === v) o.selected = true; sel.appendChild(o) }
    sel.onchange = () => { engine.updateSettings({ [key]: sel.value }); if (after) after() }
    return sel
  }
  const swatches = () => {
    const box = el('div', 'swatches')
    for (const t of themes.THEMES) {
      const v = themes.variables(t.id)
      const b = el('button', 'swatch' + (s.theme === t.id ? ' on' : ''))
      b.title = t.name
      b.style.setProperty('--sw-bg', v['--panel-2'])
      b.style.setProperty('--sw-line', v['--line-3'])
      b.style.setProperty('--sw-accent', t.accent)
      b.append(el('span', 'swatch-dot'), el('span', 'swatch-name', t.name))
      b.onclick = () => { engine.updateSettings({ theme: t.id }); themes.applyTheme(document, t.id); renderSettings() }
      box.appendChild(b)
    }
    return box
  }
  const greeting = el('input', 'stext')
  greeting.placeholder = 'What do you want to do?'
  greeting.maxLength = 60
  greeting.value = s.homeGreeting || ''
  greeting.oninput = () => { engine.updateSettings({ homeGreeting: greeting.value }); renderHome() }

  const rate = el('input')
  rate.type = 'number'; rate.min = 1; rate.max = 100; rate.value = s.packetsPerSecond
  rate.onchange = () => engine.updateSettings({ packetsPerSecond: Math.max(1, Math.min(100, Number(rate.value) || 20)) })

  group('GENERAL', [
    row('Streaming mode', 'Hides your username in JR and in plugins that support it.', toggle('streamingMode', () => { renderStatus(); renderLogs() })),
    row('Open the game when this profile opens', 'Skips Home and goes straight to Animal Jam.', toggle('openGameOnStart')),
    row('Open Trading when a trade starts', 'Shows what the other player is offering.', toggle('tradeHelper', syncTradeSwitch)),
    row('Packet limit', 'Most packets plugins can send each second. Higher can get you kicked.', rate)
  ])
  const homeGroup = group('HOME SCREEN', [
    row('Theme', 'Colors for JR and its plugin windows.', null),
    swatches(),
    row('Greeting', 'The heading on Home. Use {name} for this profile\u2019s name.', greeting),
    row('Background', null, select('homeBackground', [['none', 'Plain'], ['glow', 'Glow'], ['grid', 'Grid'], ['dots', 'Dots']], renderHome)),
    row('Search bar', null, toggle('homeShowSearch', renderHome)),
    row('Play button', null, toggle('homeShowPlay', renderHome)),
    row('Pinned plugins', null, toggle('homeShowPins', renderHome)),
    row('Activity bar', 'The latest log line at the bottom of Home.', toggle('homeShowTicker', renderHome))
  ])
  homeGroup.id = 'homeSettings'
  group('GAME', [
    row('Anti-kick', 'Stops Animal Jam from logging you out for being idle. Sends a keep-alive every 30 seconds. Turning it on or off takes effect the next time you open the game.', toggle('antiKick')),
    row('Game server', engine.dispatch.connected ? 'Connected now.' : 'Shows after you log in.', value(engine.gameServer.session ? engine.gameServer.session.upstream.host : '—')),
    row('Game proxy', 'The local port the game connects to.', value(`127.0.0.1:${engine.proxy.port}`)),
    row('Secure connection to Animal Jam', 'Keep this on unless support asks you to change it.', toggle('secureUpstream')),
    row('Item names', engine.items.ready ? `Game version ${engine.items.deployVersion}.` : 'Loads after the game starts.', button('Update', async () => { await engine.items.refresh(); await engine.items.load(); toast('Item names are up to date.'); renderSettings() }))
  ])
  group('PROFILE', [
    row(info.profile.name, 'This profile\'s settings, plugin data and game login.', button('Open folder', () => shell.openPath(info.dataDir))),
    row('Other profiles', 'Open another profile in its own window.', button('Choose profile', () => ipcRenderer.invoke('picker:show')))
  ])
  const g = info.gate || {}
  group('DISCORD', [
    row('Show JR on my Discord profile', 'Rich Presence, with a button to join the JR Discord. Needs the Discord app open on this computer.', (() => {
      const b = el('button', 'switch' + (info.richPresence !== false ? ' on' : ''))
      b.setAttribute('role', 'switch')
      b.onclick = attempt(async () => { info.richPresence = await ipcRenderer.invoke('presence:enabled', info.richPresence === false) ; b.classList.toggle('on', info.richPresence !== false) })
      return b
    })()),
    row(g.disabled ? 'Discord check is off' : g.user ? `Signed in as ${g.user.globalName || g.user.username}` : 'Signed in', 'JR is for members of the JR Discord server.', button('JR Discord', () => ipcRenderer.invoke('open-url', info.invite)))
  ])
  group('ABOUT', [
    row(`JR ${info.version}`, 'Made by BradysLabs. Not affiliated with WildWorks.', button('Developer tools', () => ipcRenderer.send('win', 'devtools')))
  ])
}

/* ------------------------------------------------------------------ gate */

ipcRenderer.on('gate', (e, g) => {
  info.gate = g
  if (g.state === 'member' || g.state === 'checking' || g.state === 'signing-in') { $('lock').classList.add('hidden'); return }
  engine.lock()
  const title = g.state === 'offline' ? 'Can’t reach Discord' : g.state === 'signed-out' ? 'Sign in to use JR' : 'You’re no longer in the JR Discord'
  const text = g.state === 'offline'
    ? 'JR couldn’t confirm your membership for more than 15 minutes. Check your internet and try again.'
    : g.state === 'signed-out'
      ? 'Your Discord sign-in ended. Sign in again from the profile picker.'
      : 'JR checks every few minutes and noticed you left the server, so JR has been locked. Rejoin to keep playing.'
  $('lockTitle').textContent = title
  $('lockText').textContent = text
  $('lock').classList.remove('hidden')
})
$('lockJoin').onclick = () => ipcRenderer.invoke('open-url', info.invite)
$('lockCheck').onclick = async () => {
  const r = await ipcRenderer.invoke('gate:check')
  if (r.ok && r.value.state === 'member') $('lock').classList.add('hidden')
  else if (r.ok && r.value.state === 'signed-out') ipcRenderer.invoke('picker:show')
}

/* ----------------------------------------------------------------- start */

window.addEventListener('beforeunload', () => { engine.shutdown() })
go('home')
engine.start().then(() => { renderStatus(); renderPins(); renderPlugins() }).catch(e => toast(e.message, true))
