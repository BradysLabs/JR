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
  const { launch } = req('game/install.js')
  const { ItemDatabase } = req('game/items.js')
  const { PluginHost } = req('plugins/host.js')
  const { readJson, writeJson } = req('profiles/files.js')

  const events = new EventEmitter()
  events.setMaxListeners(0)

  /* ------------------------------------------------------------ settings */

  const settingsFile = path.join(info.dataDir, 'settings.json')
  const DEFAULTS = {
    streamingMode: false,
    packetsPerSecond: info.packetsPerSecond || 20,
    secureUpstream: true,
    verifyCertificate: true,
    openGameOnStart: false,
    tradeHelper: true,
    pinned: ['packet-inspector', 'glow-picker', 'room-browser', 'item-previewer'],
    lastRoomName: null,
    antiKick: false,
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

  const dispatch = new Dispatch({ packetsPerSecond: settings.packetsPerSecond, log })
  const gameServer = new GameServer({
    proxyPort: () => proxy.port,
    // Anti-kick: the game file is prepared without its own idle logout.
    clientOptions: () => ({ antiIdle: !!settings.antiKick }),
    cacheDir: path.join(info.cacheDir, 'client'),
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
  const packets = []
  let packetLines = 0
  dispatch.onPacket((p) => {
    if (packetLines < 5000) {
      packetLines++
      try { fs.appendFileSync(packetFile, `${new Date(p.timestamp).toISOString()} ${p.direction === 'in' ? 'IN ' : 'OUT'}${p.fromPlugin ? ' [plugin]' : ''}${p.blocked ? ' [blocked]' : ''} ${scrub(p.raw).slice(0, 2000)}\n`) } catch (_) {}
    }
    packets.push(p)
    if (packets.length > 600) packets.splice(0, packets.length - 600)
    events.emit('packet', p)
  })

  /* --------------------------------------------------------- application */

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
    streamingMode: {
      get enabled () { return !!settings.streamingMode },
      mask (text) {
        if (!settings.streamingMode || text == null) return text
        let out = String(text)
        for (const name of ownNames()) out = out.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '•'.repeat(Math.min(8, name.length)))
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
    game = launch({ exe: r.value.exe, apiUrl: gameServer.url, userDataDir, profileName: info.profile.name })
    log({ type: 'notify', message: 'Opening Animal Jam…' })
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
    log({ type: 'notify', message: `JR ${info.version} · profile ${info.profile.name}` })
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
