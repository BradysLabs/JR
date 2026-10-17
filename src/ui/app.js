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
const trade = { active: false }
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
  const n = engine.items.name(it.id, it.kind)
  return n || `${it.kind === 'den' ? 'Den item' : 'Item'} #${it.id}`
}
function renderTrade () {
  $('tradeEmpty').classList.toggle('hidden', trade.active)
  $('trade').classList.toggle('hidden', !trade.active)
  if (!trade.active) return
  $('tradeTheirsLabel').textContent = `${engine.application.streamingMode.mask(trade.user || 'They').toUpperCase()} OFFERS`
  const box = $('tradeTheirs')
  box.innerHTML = ''
  if (!trade.offered.length) box.appendChild(el('div', 'state', 'Nothing yet'))
  const counts = new Map()
  for (const it of trade.offered) { const n = itemName(it); counts.set(n, (counts.get(n) || 0) + 1) }
  for (const [n, c] of counts) { const row = el('div', 'titem'); row.append(el('span', null, n), el('span', 'n', '×' + c)); box.appendChild(row) }
  const what = ['a clothing item', 'a clothing item', 'a clothing item', 'a den item', 'a den item', 'a den item', 'a pet'][trade.wantsType] || 'one of your items'
  $('tradeMine').innerHTML = ''
  $('tradeMine').appendChild(el('div', 'titem', `They want ${what}`))
  $('tradeNote').textContent = trade.status || 'Values from the Item Worth Wiki will show here in a JR update.'
}
engine.dispatch.onMessage({
  type: 'aj',
  message: 'ti',
  callback: ({ message }) => {
    const parts = message.value
    const code = Number(parts[4])
    if (code === 0) {
      Object.assign(trade, { active: true, status: '' }, parseTradeRequest(parts))
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

  const rate = el('input')
  rate.type = 'number'; rate.min = 1; rate.max = 100; rate.value = s.packetsPerSecond
  rate.onchange = () => engine.updateSettings({ packetsPerSecond: Math.max(1, Math.min(100, Number(rate.value) || 20)) })

  group('GENERAL', [
    row('Streaming mode', 'Hides your username in JR and in plugins that support it.', toggle('streamingMode', () => { renderStatus(); renderLogs() })),
    row('Open the game when this profile opens', 'Skips Home and goes straight to Animal Jam.', toggle('openGameOnStart')),
    row('Open Trading when a trade starts', 'Shows what the other player is offering.', toggle('tradeHelper', syncTradeSwitch)),
    row('Packet limit', 'Most packets plugins can send each second. Higher can get you kicked.', rate)
  ])
  group('GAME', [
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
