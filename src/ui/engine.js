'use strict'

/**
 * Everything one JR profile runs: the game proxy, the local game server,
 * plugins and the `application` object plugins see. Runs inside the
 * profile window (which has Node), like Jam Reborn's engine did, so window
 * plugins can use `window.jam` directly.
 */

const path = require('path')
const fs = require('fs')
const { EventEmitter } = require('events')
const { pathToFileURL } = require('url')

module.exports = function createEngine (info) {
  const req = (p) => require(path.join(info.root, 'src', p))
  const themes = req('ui/themes.js')
  const { cleanError } = req('ui/qol.js')
  const { Dispatch } = req('engine/dispatch.js')
  const { Proxy } = req('engine/proxy.js')
  const { GameServer } = req('game/server.js')
  const { createGameBridge } = req('game/bridge.js')
  const { createIncognito } = req('game/rename.js')
  const { launch } = req('game/install.js')
  const { ItemDatabase, packHash, PACKS } = req('game/items.js')
  const { rewriteStrings } = req('game/packs.js')
  const worthLabels = req('worth/labels.js')
  const { createWorthLookup } = req('worth/bubble.js')
  const { PluginHost } = req('plugins/host.js')
  const { readJson, writeJson } = req('profiles/files.js')

  const events = new EventEmitter()
  events.setMaxListeners(0)

  /* ------------------------------------------------------------ settings */

  const settingsFile = path.join(info.dataDir, 'settings.json')
  const DEFAULTS = {
    streamingMode: false,
    // Incognito (with Streaming Mode): the game and JR show streamingName,
    // your Display Name, instead of your username.
    incognito: false,
    streamingName: '',
    packetsPerSecond: info.packetsPerSecond || 20,
    secureUpstream: true,
    verifyCertificate: true,
    openGameOnStart: false,
    tradeHelper: true,
    pinned: ['packet-inspector', 'glow-picker', 'room-browser', 'item-previewer'],
    lastRoomName: null,
    antiKick: false,
    worthInNames: false,
    worthBubble: true,
    theme: 'midnight',
    homeGreeting: '',
    homeBackground: 'none',
    homeShowSearch: true,
    homeShowPlay: true,
    homeShowPins: true,
    homeShowTicker: true,
    // Quality of life (0.1.0)
    netHide: '',
    cmdHistory: [],
    reopenPlugins: true,
    openPlugins: [],
    notifications: true,
    zoom: 1,
    lastSeenVersion: null
  }
  let settings = { ...DEFAULTS, ...readJson(settingsFile, {}) }
  const saveSettings = () => writeJson(settingsFile, settings)

  /* ---------------------------------------------------------------- logs */

  const logs = []
  // Logs are also written to <profile>/logs/, so problems can be looked at later.
  const logDir = path.join(info.dataDir, 'logs')
  fs.mkdirSync(logDir, { recursive: true })
  const logFile = path.join(logDir, 'jr.log')
  const packetFile = path.join(logDir, 'packets.log')
  try { if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2e6) fs.renameSync(logFile, logFile + '.old') } catch (_) {}
  try { fs.writeFileSync(packetFile, '') } catch (_) {}
  const scrub = (text) => String(text)
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[token]')
    .replace(/("?(auth_token|authToken|refresh_token|pword|password)"?\s*[:=]\s*"?)[^"&,}<\]]+/gi, '$1[hidden]')
    .replace(/(<pword><!\[CDATA\[)[^\]]*/g, '$1[hidden]')
  const log = (entry) => {
    const e = { t: Date.now(), type: entry.type || 'notify', message: String(entry.message) }
    try { fs.appendFileSync(logFile, `${new Date(e.t).toISOString()} ${e.type.toUpperCase()} ${scrub(e.message)}\n`) } catch (_) {}
    logs.push(e)
    if (logs.length > 1000) logs.splice(0, logs.length - 1000)
    events.emit('log', e)
  }

  /* -------------------------------------------------------------- engine */

  // The game's text pack, which holds every item name.
  const STRINGS_PACK = packHash(PACKS.strings)
  let labeler = null
  let worthLookup = null
  let worthItems = null
  const worthItemList = () => {
    if (!worthItems) worthItems = JSON.parse(fs.readFileSync(path.join(info.root, 'data', 'worth', 'values.json'), 'utf8')).items || []
    return worthItems
  }
  const addWorthToNames = async (buf) => {
    if (!labeler) labeler = worthLabels.createLabeler(worthItemList())
    // Only real item names get a label, so other game text is never touched.
    // The item lists usually load in a moment; wait up to 15 seconds.
    await Promise.race([items.load().catch(() => {}), new Promise(resolve => setTimeout(resolve, 15000))])
    const names = worthLabels.itemNames(items)
    if (!names.size) {
      log({ type: 'warn', message: 'Worth in item names: the item lists weren\u2019t ready, so names were left as they are this time.' })
      return null
    }
    const result = rewriteStrings(buf, (text) => labeler.label(text, names))
    log({ type: 'success', message: `Worth in item names: added wiki worth to ${result.changed} item names.` })
    return result.changed ? result.buf : null
  }

  const dispatch = new Dispatch({ packetsPerSecond: settings.packetsPerSecond, log })
  const gameServer = new GameServer({
    proxyPort: () => proxy.port,
    // Anti-kick: the game file is prepared without its own idle logout.
    clientOptions: () => ({ antiIdle: !!settings.antiKick, itemHover: !!settings.worthBubble }),
    // The worth bubble asks here when you hover an item in the game.
    worthLookup: async (q) => {
      if (!settings.worthBubble) return { found: false }
      if (!worthLookup) {
        await Promise.race([items.load().catch(() => {}), new Promise(resolve => setTimeout(resolve, 15000))])
        worthLookup = createWorthLookup({ worthItems: worthItemList(), db: items })
      }
      return worthLookup(q)
    },
    // Worth in item names: the game's text pack gets wiki worth added to
    // item names on its way in, so Animal Jam's own labels show it.
    contentFilter: {
      wants: (name) => !!settings.worthInNames && name.endsWith(`/defPacks/${STRINGS_PACK}`),
      apply: (name, buf) => addWorthToNames(buf)
    },
    cacheDir: path.join(info.cacheDir, 'client'),
    modsDir: path.join(info.root, 'game-mods'),
    // JR's in-game features: built on this computer from the player's own game file.
    modBuilder: req('game/mod/build.js').createModBuilder({
      toolsDir: path.join(info.userData || path.dirname(info.cacheDir), 'jr-tools'),
      outDir: path.join(info.cacheDir, 'game-mods'),
      log
    }),
    log
  })
  const proxy = new Proxy({
    dispatch,
    upstream: () => ({ ...gameServer.upstream(), secure: settings.secureUpstream, verify: settings.verifyCertificate })
  })
  // The game's first message names the server address it connected to,
  // which is JR (127.0.0.1). Tell the server the real address instead.
  dispatch.onMessage({
    type: 'connection',
    message: 'sv',
    callback: ({ message }) => {
      const parts = message.value
      if (Array.isArray(parts) && parts[5] === '127.0.0.1' && gameServer.session) parts[5] = gameServer.session.originalServer
    }
  })

  // Animal Jam's server sends Flash access rules that only allow its own
  // websites. The game is loaded from JR here, so give it open rules instead.
  dispatch.onMessage({
    type: 'aj',
    callback: ({ message }) => {
      if (message.type === null && typeof message.raw === 'string' && message.raw.includes('cross-domain-policy')) {
        message.format = 'text'
        message.value = '<?xml version="1.0"?><cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>'
      }
    }
  })

  // Anti-kick: tell the server you're still here every 30 seconds.
  const KEEP_ALIVE_EVERY = 30000
  const keepAlive = setInterval(() => {
    if (!settings.antiKick || !dispatch.connected) return
    const room = dispatch.getState('room')
    if (!room) return
    dispatch.sendRemoteMessage(`%xt%o%ka%${room}%`).catch(() => {})
  }, KEEP_ALIVE_EVERY)
  if (keepAlive.unref) keepAlive.unref()

  let serverName = null
  gameServer.on('session', (s) => { serverName = s.server; events.emit('status') })
  dispatch.on('connected', () => events.emit('status'))
  dispatch.on('disconnected', () => events.emit('status'))
  // Rooms you've been in since you logged in, newest first.
  const recentRooms = []
  dispatch.on('state', (key, value) => {
    if (key === 'roomName' && value) {
      settings.lastRoomName = value; saveSettings()
      const name = String(value)
      const at = recentRooms.findIndex(r => r.name === name)
      if (at !== -1) recentRooms.splice(at, 1)
      recentRooms.unshift({ name, id: String(dispatch.getState('room') || ''), at: Date.now(), den: /^den./i.test(name) })
      if (recentRooms.length > 30) recentRooms.length = 30
    }
    if (key === 'player') recentRooms.length = 0 // a new login
    events.emit('state', key, value)
  })

  const items = new ItemDatabase({
    cacheDir: path.join(info.cacheDir, 'items'),
    source: () => gameServer.session && { content: gameServer.session.content, version: gameServer.session.version }
  })

  // Packet history for the Logs page.
  // The log file is written once a second, off the packet's path, so saving
  // it never holds up the game.
  const packets = []
  let packetLines = 0
  let packetBuffer = []
  const flushPackets = () => {
    if (!packetBuffer.length) return
    const text = packetBuffer.join('')
    packetBuffer = []
    fs.appendFile(packetFile, text, () => {})
  }
  const packetFlush = setInterval(flushPackets, 1000)
  if (packetFlush.unref) packetFlush.unref()
  dispatch.onPacket((p) => {
    if (packetLines < 5000) {
      packetLines++
      packetBuffer.push(`${new Date(p.timestamp).toISOString()} ${p.direction === 'in' ? 'IN ' : 'OUT'}${p.fromPlugin ? ' [plugin]' : ''}${p.blocked ? ' [blocked]' : ''} ${scrub(p.raw).slice(0, 2000)}\n`)
    }
    packets.push(p)
    if (packets.length > 600) packets.splice(0, packets.length - 600)
    events.emit('packet', p)
  })

  /* --------------------------------------------------------- application */

  const { cleanName } = req('game/rename.js')
  // Your Display Name while Streaming Mode and Incognito are both on, else ''.
  const streamingName = () => (settings.streamingMode && settings.incognito && (cleanName(settings.streamingName) || 'Incognito')) || ''
  const ownNames = () => {
    const p = dispatch.getState('player') || {}
    return [p.userName, p.username, p.screenName].filter(Boolean).map(String)
  }
  const application = {
    version: info.version,
    profile: info.profile,
    dataPath: info.dataDir,
    items,
    dispatch,
    consoleMessage: ({ type = 'notify', message }) => log({ type, message }),
    settings: {
      get: (key) => {
        if (key === 'smartfoxServer') return gameServer.session ? gameServer.session.upstream.host : null
        if (key === 'secureConnection') return settings.secureUpstream
        return settings[key]
      },
      set: (key, value) => { settings[key] = value; saveSettings(); events.emit('settings') },
      all: () => ({ ...settings })
    },
    // Streaming Mode: your username is hidden in JR, or shown as your
    // Display Name when Incognito is on.
    streamingMode: {
      get enabled () { return !!settings.streamingMode },
      mask (text) {
        if (!settings.streamingMode || text == null) return text
        let out = String(text)
        const alias = streamingName()
        for (const name of ownNames()) out = out.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), alias || '\u2022'.repeat(Math.min(8, name.length)))
        return out
      }
    },
    hideSecrets (text) {
      return String(text)
        .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[token]')
        .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    },
    open: (url) => events.emit('open-url', url),
    /**
     * Shows a desktop notification when JR isn't the window in front
     * (or always, with force). The user can turn these off in Settings.
     */
    /** Rooms you've been in since logging in, newest first: [{ name, id, at, den }]. */
    recentRooms: () => recentRooms.map(r => ({ ...r })),
    notify: ({ title = 'JR', body = '', force = false } = {}) => {
      if (!settings.notifications) return false
      events.emit('notify', { title: String(title), body: String(body), force: !!force })
      return true
    }
  }

  /* ------------------------------------------------------------- plugins */

  fs.mkdirSync(info.userPlugins, { recursive: true })
  const host = new PluginHost({
    folders: [{ path: path.join(info.root, 'plugins'), builtIn: true }, { path: info.userPlugins }],
    profileDir: info.dataDir,
    dispatch,
    application,
    log
  })
  host.on('change', () => events.emit('plugins'))

  const windows = new Map() // plugin id -> { popup, jam }
  // The last error each plugin window hit, so its card can show it.
  const pluginErrors = new Map()

  /** Records an error from a plugin window and shows it in that window. */
  function reportPluginError (id, message) {
    const plugin = host.plugins.get(id)
    const name = plugin && plugin.manifest ? plugin.manifest.name : id
    if (pluginErrors.get(id) === message) return
    pluginErrors.set(id, message)
    log({ type: 'error', message: `${name}: ${message}` })
    const open = windows.get(id)
    if (open && !open.popup.closed) showErrorInWindow(open.popup, message)
    events.emit('plugins')
  }

  function showErrorInWindow (popup, message) {
    try {
      const doc = popup.document
      let bar = doc.getElementById('jr-error-bar')
      if (!bar) {
        bar = doc.createElement('div')
        bar.id = 'jr-error-bar'
        bar.title = 'Click to hide'
        bar.style.cssText = 'position:fixed;left:10px;right:10px;bottom:10px;z-index:2147483647;background:#2a0f12;color:#fecaca;border:1px solid #5b2a2f;border-radius:10px;padding:9px 12px;font:12.5px/1.45 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5);cursor:pointer;word-break:break-word'
        bar.onclick = () => bar.remove()
        doc.body.appendChild(bar)
      }
      bar.textContent = `This plugin hit an error: ${message}`
    } catch (_) {}
  }

  function openPlugin (id) {
    const open = windows.get(id)
    if (open && !open.popup.closed) { open.popup.focus(); return }
    pluginErrors.delete(id)
    const jamView = host.openWindow(id)
    const name = jamView.plugin.name
    const popup = window.open(pathToFileURL(jamView.entry).href, `jr-plugin-${id}`)
    if (!popup) throw new Error(`Couldn't open ${name}.`)
    const jam = {
      application,
      dispatch: jamView.dispatch,
      onPacket: jamView.onPacket,
      offPacket: () => {},
      storage: jamView.storage,
      dataPath: jamView.dataPath,
      plugin: jamView.plugin
    }
    const attach = () => {
      try {
        if (!popup.jam) popup.jam = jam
        const doc = popup.document
        if (doc && doc.documentElement && doc.documentElement.dataset.theme !== settings.theme) themes.applyTheme(doc, settings.theme)
        if (doc && doc.head && !doc.getElementById('jr-style')) {
          const link = doc.createElement('link')
          link.id = 'jr-style'
          link.rel = 'stylesheet'
          link.href = 'app://assets/styles/style.css'
          doc.head.prepend(link)
        }
      } catch (_) {}
    }
    attach()
    let tries = 0
    const early = setInterval(() => { attach(); if (++tries > 80) clearInterval(early) }, 25)
    try {
      // The main process also reports these from the window's console; reportPluginError skips repeats.
      popup.addEventListener('error', (e) => reportPluginError(id, cleanError(e.message)))
    } catch (_) {}
    const watch = setInterval(() => {
      if (!popup.closed) return
      clearInterval(watch)
      clearInterval(early)
      jamView.dispose()
      windows.delete(id)
      events.emit('plugins')
    }, 400)
    windows.set(id, { popup, jam })
    log({ type: 'notify', message: `Opened ${name}.` })
    events.emit('plugins')
  }

  function closePluginWindows () {
    for (const { popup } of windows.values()) { try { popup.close() } catch (_) {} }
  }

  /* ---------------------------------------------------------------- game */

  let game = null
  async function play () {
    if (game) return
    const ipc = require('electron').ipcRenderer
    const r = await ipc.invoke('game:prepare')
    if (!r.ok) throw new Error(r.error)
    const userDataDir = path.join(info.dataDir, 'game')
    game = launch({ exe: r.value.exe, apiUrl: gameServer.url, userDataDir, profileName: info.profile.name, token: gameServer.token })
    log({ type: 'notify', message: 'Opening Animal Jam…' })
    log({ type: 'notify', message: `Worth in item names is ${settings.worthInNames ? 'on' : 'off'} for this game.` })
    game.on('exit', () => {
      game = null
      log({ type: 'notify', message: 'Animal Jam closed.' })
      events.emit('status')
    })
    game.on('error', (error) => {
      game = null
      log({ type: 'error', message: `Couldn't open Animal Jam: ${error.message}` })
      events.emit('status')
    })
    events.emit('status')
  }
  function stopGame () {
    if (game) { try { game.kill() } catch (_) {} }
  }

  /* ------------------------------------------------------------ lifecycle */

  async function start () {
    log({ type: 'notify', message: `JR ${info.version} (test build) · profile ${info.profile.name}` })
    await proxy.listen()
    await gameServer.listen()
    log({ type: 'notify', message: `Game proxy ready on port ${proxy.port}.` })
    const list = host.load()
    const waiting = list.filter(p => p.status === 'needs-approval' || p.status === 'changed').length
    log({ type: 'notify', message: `Loaded ${list.length} plugins${waiting ? ` (${waiting} waiting for your OK)` : ''}.` })
    const loadItems = () => items.load()
      .then(() => {
        log({ type: 'success', message: `Item names ready (${items.clothing.size + items.den.size} items, game version ${items.deployVersion}).` })
        events.emit('items')
      })
      .catch((e) => log({ type: 'warn', message: `Item names didn't load: ${e.message}` }))
    loadItems()
    // Try again once the game has logged in (then JR knows the exact game version).
    gameServer.once('session', () => { if (!items.ready) setTimeout(loadItems, 3000) })
    if (settings.openGameOnStart) play().catch(e => log({ type: 'error', message: e.message }))
    reopenPlugins()
  }

  /** Opens the plugin windows that were open when this profile last closed. */
  function reopenPlugins () {
    if (!settings.reopenPlugins) return
    const ids = Array.isArray(settings.openPlugins) ? settings.openPlugins : []
    const ready = ids.filter(id => { const p = host.plugins.get(id); return p && p.status === 'ready' })
    ready.forEach((id, i) => setTimeout(() => {
      try { openPlugin(id) } catch (e) { log({ type: 'warn', message: `Couldn't reopen ${id}: ${e.message}` }) }
    }, 300 + i * 150))
  }

  async function shutdown () {
    clearInterval(keepAlive)
    // Remember which plugin windows were open, to open them again next time.
    try {
      settings.openPlugins = [...windows.keys()].filter(id => !windows.get(id).popup.closed)
      saveSettings()
    } catch (_) {}
    closePluginWindows()
    host.unloadAll()
    stopGame()
    await proxy.close().catch(() => {})
    await gameServer.close().catch(() => {})
  }

  function lock () {
    // Lost Discord membership: disconnect and stop everything.
    closePluginWindows()
    stopGame()
    if (proxy.current) proxy.current.close('JR is locked')
  }

  /* ------------------------------------------------------ in-game panel */

  // Settings the in-game panel may change, with what it shows for them.
  const INGAME_SETTINGS = {
    // short: the label in Animal Jam's own Settings window (two short lines at most)
    streamingMode: { label: 'Streaming mode', short: 'Streaming Mode', detail: 'Hides your username in JR.' },
    incognito: { label: 'Incognito', short: 'Incognito', detail: 'With Streaming mode: shows your Display Name instead of your username. Name tags right away, everything else next login.' },
    antiKick: { label: 'Anti-kick', short: 'Anti-Kick', detail: 'Keeps you from being logged out for being idle. Next game.' },
    tradeHelper: { label: 'Open Trading when a trade starts', short: 'Trade Helper', detail: 'Shows what the other player is offering.' },
    worthBubble: { label: 'Worth bubble on hover', short: 'Worth Bubble', detail: 'Next game.' },
    worthInNames: { label: 'Worth in item names', short: 'Worth In Names', detail: 'Next game.' },
    notifications: { label: 'Desktop notifications', short: 'Notifications', detail: 'For things like an item selling from your shop.' }
  }
  const shopApi = () => dispatch.getState('shopTemplates')
  const nativeShopRows = () => {
    // Keep the entry point visible outside the player's den too; the action
    // rows below only apply while JR has a live view of the player's shop.
    const rows = [{ k: 'shop:open', l: 'My Shop Templates', f: 'autoServer', y: 'b', b: 'Open' }]
    try {
      const api = shopApi()
      if (!api || typeof api.snapshot !== 'function') return rows
      const snap = api.snapshot()
      if (!snap || !snap.ready || !snap.ready.den || !Array.isArray(snap.stands) || !snap.stands.length) return rows
      const stand = snap.stands[0]
      const shopId = Number(stand.id)
      if (!Number.isInteger(shopId) || shopId < 0) return rows
      const templates = Array.isArray(snap.templates) ? snap.templates : []
      rows.push({ k: `shop:save:${shopId}`, l: 'Save My Shop template', f: 'autoServer', y: 'b', b: 'Save' })
      if (templates.length) {
        const template = templates[templates.length - 1]
        const name = String(template.name || 'Last template').slice(0, 14)
        rows.push({ k: `shop:refill:${shopId}:${template.id}`, l: `Refill · ${name}`, f: 'autoServer', y: 'b', b: 'Refill' })
        const active = stand.auto && stand.auto.templateId === template.id
        rows.push({ k: `shop:auto:${shopId}:${template.id}`, l: `Auto-refill · ${name}`, f: 'autoServer', v: !!active })
      }
      const explorer = typeof api.explorer === 'function' ? api.explorer() : null
      if (explorer && explorer.here && explorer.stands && explorer.stands.length) {
        rows.push({ k: explorer.scan ? 'shop:stopscan' : 'shop:scan', l: explorer.scan ? `Stop shop scan ${explorer.scan.done}/${explorer.scan.total}` : 'Scan shops in this den', f: 'autoServer', y: 'b', b: explorer.scan ? 'Stop' : 'Scan' })
      }
      return rows
    } catch (error) {
      log({ type: 'warn', message: `In-game My Shop controls unavailable: ${error.message}` })
      return rows
    }
  }
  const { describeRoom, joinPacket } = require(path.join(info.root, 'plugins', 'recent-rooms', 'rooms.js'))
  const roomCatalog = readJson(path.join(info.root, 'plugins', 'room-browser', 'Rooms.json'), [])
  const nativeRoomRows = () => {
    const saved = readJson(path.join(host.profileDir, 'plugin-data', 'room-browser', 'storage.json'), {}) || {}
    const favorites = Array.isArray(saved.favorites) ? saved.favorites : []
    const favorite = favorites.find(f => f && roomCatalog.some(r => r.path === f.path && r.joinable))
    const room = favorite
      ? { name: `${favorite.path.replace(/\//g, '.')}#1`, title: favorite.category || favorite.name }
      : (() => {
          const recent = recentRooms.find(r => r.name !== dispatch.getState('roomName'))
          return recent && { name: recent.name, title: describeRoom(recent.name).title }
        })()
    if (!room) return []
    const token = Buffer.from(room.name, 'utf8').toString('base64url')
    return [{ k: `room:join:${token}`, l: `Visit ${String(room.title).slice(0, 24)}`, f: 'autoServer', y: 'b', b: 'Go' }]
  }
  const nativeOutfitRows = () => {
    const saved = readJson(path.join(host.profileDir, 'plugin-data', 'outfits', 'storage.json'), {}) || {}
    const outfits = Array.isArray(saved.outfits) ? saved.outfits : []
    const outfit = outfits[outfits.length - 1]
    if (!outfit || !outfit.id || !outfit.name) return []
    const token = Buffer.from(String(outfit.id), 'utf8').toString('base64url')
    return [{ k: `outfit:wear:${token}`, l: `Wear ${String(outfit.name).slice(0, 18)}`, f: 'autoServer', y: 'b', b: 'Wear' }]
  }
  let recycleConfirm = null
  const recyclePreset = () => {
    const saved = readJson(path.join(host.profileDir, 'plugin-data', 'recycle-tool', 'storage.json'), {}) || {}
    const presets = Array.isArray(saved.presets) ? saved.presets : []
    return presets.find(p => p.id === saved.current) || presets[0] || null
  }
  const nativeRecycleRows = () => {
    const preset = recyclePreset()
    const api = shopApi()
    if (!preset || !api || typeof api.planRecycle !== 'function') {
      return [{ k: 'recycle:open', l: 'Recycle Tool', f: 'autoServer', y: 'b', b: 'Open' }]
    }
    const plan = api.planRecycle(preset.items || [])
    const count = plan.recycle.length
    const confirming = recycleConfirm && recycleConfirm.id === preset.id && Date.now() <= recycleConfirm.until
    const status = api.recycleSnapshot()
    return [
      { k: `recycle:run:${preset.id}`, l: confirming ? `Confirm recycle ${count}` : `Recycle ${count} · ${String(preset.name || 'Preset').slice(0, 14)}`, f: 'autoServer', y: 'b', b: confirming ? 'Confirm' : 'Recycle' },
      { k: `recycle:auto:${preset.id}`, l: 'Auto-recycle', f: 'autoServer', v: !!status.auto }
    ]
  }
  let worthNames = null
  const worthSuggestions = (query) => {
    if (!worthNames) worthNames = [...new Set(worthItemList().map(it => it.page).filter(Boolean))].sort()
    const q = String(query || '').toLowerCase().trim()
    if (q.length < 2) return []
    const starts = worthNames.filter(n => n.toLowerCase().startsWith(q))
    const has = worthNames.filter(n => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q))
    return [...starts, ...has].slice(0, 8)
  }
  const mask = (text) => application.streamingMode.mask(String(text || ''))

  // JR's in-game build talks to JR over the game connection (src/game/bridge.js).
  // Icons are frames of the game's own Settings icons.
  const GAME_ICONS = { streamingMode: 'jammerWallIcon', incognito: 'nameBadge', antiKick: 'autoServer', tradeHelper: 'buddyRequest', worthBubble: 'predictTxt', worthInNames: 'predictTxt', notifications: 'doorBell' }
  const incognito = createIncognito({ dispatch, alias: streamingName, log })
  let gameSurfaces = null
  const gameBridge = createGameBridge({
    dispatch,
    log,
    anchors: () => (gameSurfaces ? gameSurfaces.anchors() : {}),
    // Diamond worth of each item you own, for the game's Most valuable sort.
    worthMap: () => {
      const { inventoryOf } = req('game/surfaces/wardrobe.js')
      const inv = inventoryOf({ dispatch, profileDir: host.profileDir })
      const pricer = gameSurfaces ? gameSurfaces.ctx.pricer() : null
      const out = {}
      if (!pricer) return out
      const mid = (d) => (d ? Math.round((d.min + d.max) / 2) : undefined)
      for (const c of inv.clothing || []) {
        const color = Number(c.color) >>> 0
        const key = `c${c.defId}_${color}`
        if (!(key in out)) { const w = mid(pricer.value({ kind: 'clothing', id: c.defId, color }).diamonds); if (w != null) out[key] = w }
      }
      for (const d of inv.den || []) {
        const key = `d${d.defId}`
        if (!(key in out)) { const w = mid(pricer.value({ kind: 'den', id: d.defId, color: null }).diamonds); if (w != null) out[key] = w }
      }
      return out
    },
    // Where the game's screens put things, kept in logs/game-layout.json for
    // placing JR's buttons (src/game/surfaces ANCHORS).
    report: (layout) => {
      const file = path.join(info.root, 'logs', 'game-layout.json')
      const all = readJson(file, {}) || {}
      all[layout.id ? `${layout.what}:${layout.id}` : layout.what] = Object.assign({ at: new Date().toISOString() }, layout)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      writeJson(file, all)
    },
    // Where the game's screens put things, kept in logs/game-layout.json for
    // placing JR's buttons (src/game/surfaces ANCHORS).
    report: (layout) => {
      const file = path.join(info.root, 'logs', 'game-layout.json')
      const all = readJson(file, {}) || {}
      all[layout.id ? `${layout.what}:${layout.id}` : layout.what] = Object.assign({ at: new Date().toISOString() }, layout)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      writeJson(file, all)
    },
    rows: () => {
      const general = Object.entries(INGAME_SETTINGS).flatMap(([key, s]) => {
        const row = { k: key, l: s.short, f: GAME_ICONS[key] || 'autoServer', v: !!settings[key] }
        return key === 'incognito' ? [row, { k: 'streamingName', l: 'Display Name', f: 'nameBadge', y: 'b', b: 'Edit' }] : [row]
      })
      // Keep this surface for preferences that belong in Settings. Plugin
      // features need controls in their own game screens, not a shortcut list
      // mixed into the Settings panel.
      return general
    },
    toggle: (key, value) => {
      if (key.startsWith('recycle:auto:')) {
        const preset = recyclePreset()
        const api = shopApi()
        if (!preset || preset.id !== key.split(':')[2]) throw new Error('That recycle preset is no longer available.')
        if (!api || typeof api.setAutoRecycle !== 'function') throw new Error('My Shop Restocker is not running.')
        if (value && !(preset.items || []).length) throw new Error('Add items to the recycle preset in Recycle Tool first.')
        api.setAutoRecycle(value ? { name: preset.name, entries: preset.items } : null)
        const message = value ? `Auto-recycle is on for “${preset.name}”.` : 'Auto-recycle is off.'
        dispatch.serverMessage(message)
        log({ type: 'success', message })
        return
      }
      if (key.startsWith('shop:auto:')) {
        const [, , shopId, templateId] = key.split(':')
        const api = shopApi()
        if (!api || typeof api.setAuto !== 'function') throw new Error('My Shop Restocker is not running.')
        api.setAuto(Number(shopId), value ? templateId : '', 'empty')
        const message = value ? 'My Shop will refill when empty.' : 'Automatic shop refills are off.'
        dispatch.serverMessage(message)
        log({ type: 'success', message })
        return
      }
      if (!INGAME_SETTINGS[key]) return
      updateSettings({ [key]: value })
      log({ type: 'notify', message: `${INGAME_SETTINGS[key].label} turned ${value ? 'on' : 'off'} from the game.` })
    },
    press: async (key) => {
      const parts = String(key || '').split(':')
      if (parts[0] === 'room' && parts[1] === 'favorite') {
        const saved = readJson(path.join(host.profileDir, 'plugin-data', 'room-browser', 'storage.json'), {}) || {}
        const favorites = Array.isArray(saved.favorites) ? saved.favorites : []
        const favorite = favorites.find(room => room && roomCatalog.some(entry => entry.path === room.path && entry.joinable))
        if (!favorite) throw new Error('Save a joinable room in Room Browser Favorites first.')
        const name = `${favorite.path.replace(/\//g, '.')}#1`
        await dispatch.sendRemoteMessage(joinPacket(dispatch.getState('room'), name))
        dispatch.serverMessage(`Going to ${favorite.category || favorite.name || 'your favorite room'}…`)
        return
      }
      if (parts[0] === 'room' && parts[1] === 'join') {
        const name = Buffer.from(parts[2] || '', 'base64url').toString('utf8')
        const isRecent = recentRooms.some(room => room.name === name)
        const saved = readJson(path.join(host.profileDir, 'plugin-data', 'room-browser', 'storage.json'), {}) || {}
        const favorites = Array.isArray(saved.favorites) ? saved.favorites : []
        const isFavorite = favorites.some(room => room && roomCatalog.some(r => r.path === room.path && r.joinable) && `${room.path.replace(/\//g, '.')}#1` === name)
        if (!isRecent && !isFavorite) throw new Error('That room is no longer in your recent list or favorites.')
        await dispatch.sendRemoteMessage(joinPacket(dispatch.getState('room'), name))
        return
      }
      if (parts[0] === 'outfit' && parts[1] === 'wear') {
        const id = Buffer.from(parts[2] || '', 'base64url').toString('utf8')
        const saved = readJson(path.join(host.profileDir, 'plugin-data', 'outfits', 'storage.json'), {}) || {}
        const outfits = Array.isArray(saved.outfits) ? saved.outfits : []
        const outfit = outfits.find(item => String(item.id) === id)
        if (!outfit) throw new Error('That saved outfit is no longer available.')
        const api = shopApi()
        if (!api || typeof api.wearOutfit !== 'function') throw new Error('Outfits need My Shop Restocker running.')
        const result = await api.wearOutfit(outfit, { clothing: true, look: false })
        const changed = result.putOn + result.tookOff
        const message = `${outfit.name}: ${changed ? 'outfit applied' : 'already wearing it'}.${result.missing.length ? ` Missing: ${result.missing.join(', ')}.` : ''}`
        dispatch.serverMessage(message)
        log({ type: result.missing.length ? 'warn' : 'success', message })
        return
      }
      if (parts[0] === 'recycle') {
        if (parts[1] === 'open') { openPlugin('recycle-tool'); return }
        if (parts[1] !== 'run') throw new Error('That Recycle Tool action is not available.')
        const preset = recyclePreset()
        const api = shopApi()
        if (!preset || preset.id !== parts[2]) throw new Error('That recycle preset is no longer available.')
        if (!api || typeof api.recycleNow !== 'function') throw new Error('My Shop Restocker is not running.')
        const plan = api.planRecycle(preset.items || [])
        if (!plan.recycle.length) { dispatch.serverMessage('Nothing in this preset can be recycled right now.'); return }
        if (!recycleConfirm || recycleConfirm.id !== preset.id || Date.now() > recycleConfirm.until) {
          // Clicking a native Settings button closes the game's Settings
          // window. Leave enough time to reopen it and press Confirm.
          recycleConfirm = { id: preset.id, until: Date.now() + 15000 }
          dispatch.serverMessage(`Reopen Settings and press Confirm within 15 seconds to recycle ${plan.recycle.length} items.`)
          return
        }
        recycleConfirm = null
        const result = await api.recycleNow(preset.items || [], preset.name)
        const message = result.recycled ? `JR recycled ${result.recycled} item${result.recycled === 1 ? '' : 's'}.` : 'Nothing to recycle.'
        dispatch.serverMessage(message)
        log({ type: 'success', message })
        return
      }
      if (parts[0] !== 'shop') return
      if (parts[1] === 'open') {
        openPlugin('shop-templates')
        return
      }
      if (parts[1] === 'scan' || parts[1] === 'stopscan') {
        const api = shopApi()
        if (!api) throw new Error('My Shop Restocker is not running.')
        if (parts[1] === 'stopscan') {
          api.stopScan()
          dispatch.serverMessage('Shop scan stopping…')
          return
        }
        dispatch.serverMessage('JR is checking each shop in this den…')
        const result = await api.scanDen()
        const message = `Scanned ${result.shops} shop${result.shops === 1 ? '' : 's'} and found ${result.items} item${result.items === 1 ? '' : 's'} for sale.${result.failed ? ` ${result.failed} shop${result.failed === 1 ? ' was' : 's were'} unavailable.` : ''}`
        dispatch.serverMessage(message)
        log({ type: result.failed ? 'warn' : 'success', message })
        return
      }
      const shopId = Number(parts[2])
      if (!Number.isInteger(shopId) || shopId < 0) throw new Error('That shop is no longer available.')
      const api = shopApi()
      if (!api) throw new Error('My Shop Restocker is not running.')
      if (parts[1] === 'save') {
        const snap = api.snapshot()
        const template = await api.saveTemplate(shopId, `My Shop ${snap.templates.length + 1}`)
        const message = `Saved “${template.name}” as a shop template.`
        dispatch.serverMessage(message)
        log({ type: 'success', message })
        return
      }
      if (parts[1] === 'refill') {
        const templateId = parts.slice(3).join(':')
        const result = await api.restock(shopId, templateId)
        const message = result.added
          ? `JR added ${result.added} item${result.added === 1 ? '' : 's'} to your shop.`
          : result.full ? 'Your shop already matches that template.' : 'JR could not refill the shop; check JR Logs.'
        dispatch.serverMessage(message)
        log({ type: result.missing && result.missing.length ? 'warn' : 'success', message })
        return
      }
      throw new Error('That My Shop action is not available.')
    },
    worth: (q) => gameServer.worthLookup(q),
    // show: the name the game shows for you right now ('' = leave it); ids: names
    // the game may know you by this session; saved: for the edit box.
    profile: () => {
      const s = incognito.session
      return { show: streamingName() || (s ? s.real : ''), ids: incognito.ids(), saved: cleanName(settings.streamingName) }
    },
    rename: (name) => {
      updateSettings({ streamingName: cleanName(name) })
      log({ type: 'notify', message: name ? 'Display Name changed from the game.' : 'Display Name cleared from the game.' })
    }
  })
  // Settings changed in JR's window reach the game right away.
  events.on('settings', () => { if (dispatch.connected) gameBridge.sendRows() })

  // Every plugin in its own spot in the game: a button on the game screen it
  // belongs to, and a window the game draws (src/game/surfaces).
  const { createSurfaces } = req('game/surfaces/index.js')
  const pluginReady = (id) => { const p = host.plugins.get(id); return !!p && (p.status === 'ready' || p.status === 'running') }
  const surfaceList = ['wardrobe', 'shop', 'buying', 'social', 'play', 'tools'].flatMap(name => req(`game/surfaces/${name}.js`))
  let pricer = null
  const membershipFile = () => path.join(host.profileDir, 'plugin-data', 'membership', 'storage.json')
  gameSurfaces = createSurfaces({
    bridge: gameBridge,
    enabled: pluginReady,
    surfaces: surfaceList,
    ctx: {
      dispatch,
      items,
      log,
      application,
      root: info.root,
      profileDir: host.profileDir,
      version: info.version,
      settings: () => settings,
      updateSettings,
      mask,
      recentRooms: () => recentRooms,
      shopApi: () => dispatch.getState('shopTemplates'),
      openPlugin: (id) => openPlugin(id),
      focusJR: () => require('electron').ipcRenderer.send('win', 'focus'),
      pricer: () => {
        if (pricer) return pricer
        const made = require(path.join(info.root, 'src', 'worth', 'pricer.js')).createPricer({ root: info.root, items })
        if (items.ready) pricer = made
        return made
      },
      membership: () => { const d = readJson(membershipFile(), {}) || {}; return d.enabled !== false },
      setMembership: (on) => dispatch.runCommand(`membership ${on ? 'on' : 'off'}`),
      surfaceEnabled: (id) => { const s = surfaceList.find(x => x.id === id); return !!s && (!s.plugin || pluginReady(s.plugin)) }
    }
  })
  gameBridge.setSurfaces(gameSurfaces)
  // Turning a plugin on or off adds or removes its buttons in the game.
  host.on('change', () => { if (dispatch.connected) gameBridge.sendAnchors(false) })
  // The native quick-visit buttons track the rooms visited this login.
  dispatch.on('state', (key) => {
    if ((key === 'roomName' || key === 'player') && dispatch.connected) gameBridge.sendRows()
  })

  gameServer.ingame = {
    state () {
      const open = new Set([...windows.keys()].filter(id => !windows.get(id).popup.closed))
      return {
        version: info.version,
        profile: info.profile.name,
        server: serverName,
        connected: !!dispatch.connected,
        room: dispatch.getState('roomName') ? mask(dispatch.getState('roomName')) : null,
        plugins: host.list()
          .filter(p => p.type !== 'game')
          .map(p => ({ id: p.id, name: p.name, description: p.description || '', category: p.category || 'Other', status: p.status, open: open.has(p.id) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        pinned: Array.isArray(settings.pinned) ? settings.pinned : [],
        rooms: recentRooms.slice(0, 15).map(r => ({ name: r.name, title: describeRoom(r.name).title, detail: describeRoom(r.name).detail, den: r.den, at: r.at })),
        settings: Object.entries(INGAME_SETTINGS).map(([key, s]) => ({ key, label: s.label, short: s.short, detail: s.detail, value: !!settings[key] })),
        logs: logs.slice(-40).map(e => ({ t: e.t, type: e.type, message: mask(e.message) }))
      }
    },
    async action (request) {
      const a = request && request.action
      if (a === 'openPlugin') {
        const p = host.plugins.get(String(request.id))
        if (!p) throw new Error('No such plugin.')
        openPlugin(p.id)
        const w = windows.get(p.id)
        if (w) try { w.popup.focus() } catch (_) {}
        return { ok: true }
      }
      if (a === 'setting') {
        const key = String(request.key)
        if (!INGAME_SETTINGS[key]) throw new Error('That setting can\u2019t be changed from the game.')
        updateSettings({ [key]: !!request.value })
        log({ type: 'notify', message: `${INGAME_SETTINGS[key].label} turned ${request.value ? 'on' : 'off'} from the game.` })
        return { ok: true }
      }
      if (a === 'joinRoom') {
        if (!dispatch.connected) throw new Error('Log in to Animal Jam first.')
        await dispatch.sendRemoteMessage(joinPacket(dispatch.getState('room'), String(request.name || '')))
        return { ok: true }
      }
      if (a === 'worth') {
        const name = String(request.name || '')
        if (!worthLookup) worthLookup = createWorthLookup({ worthItems: worthItemList(), db: items })
        return { result: name ? worthLookup({ name }) : null, suggestions: worthSuggestions(name) }
      }
      if (a === 'log') {
        log({ type: 'notify', message: `In game: ${String(request.message || '').slice(0, 200)}` })
        return { ok: true }
      }
      if (a === 'showJR') {
        require('electron').ipcRenderer.send('win', 'focus')
        return { ok: true }
      }
      throw new Error('Unknown action.')
    }
  }

  function updateSettings (patch) {
    settings = { ...settings, ...patch }
    saveSettings()
    if ('packetsPerSecond' in patch) dispatch.limiter.setRate(settings.packetsPerSecond)
    if ('theme' in patch) {
      for (const { popup } of windows.values()) { try { themes.applyTheme(popup.document, settings.theme) } catch (_) {} }
    }
    events.emit('settings')
  }

  return {
    events,
    dispatch,
    proxy,
    gameServer,
    host,
    items,
    application,
    logs,
    packets,
    get settings () { return settings },
    updateSettings,
    get serverName () { return serverName },
    get gameRunning () { return !!game },
    get openWindows () { return new Set([...windows.keys()].filter(id => !windows.get(id).popup.closed)) },
    /** The open window of a plugin, or null. */
    pluginWindow (id) { const w = windows.get(id); return w && !w.popup.closed ? w.popup : null },
    pluginErrors,
    reportPluginError,
    openPlugin,
    play,
    stopGame,
    start,
    shutdown,
    lock,
    log
  }
}
