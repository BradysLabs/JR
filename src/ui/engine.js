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
    lastRoomName: null
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

  let serverName = null
  gameServer.on('session', (s) => { serverName = s.server; events.emit('status') })
  dispatch.on('connected', () => events.emit('status'))
  dispatch.on('disconnected', () => events.emit('status'))
  dispatch.on('state', (key, value) => {
    if (key === 'roomName' && value) { settings.lastRoomName = value; saveSettings() }
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
    open: (url) => events.emit('open-url', url)
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

  function openPlugin (id) {
    const open = windows.get(id)
    if (open && !open.popup.closed) { open.popup.focus(); return }
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
      popup.addEventListener('error', (e) => log({ type: 'error', message: `${name}: ${e.message}` }))
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
      .then(() => log({ type: 'success', message: `Item names ready (${items.clothing.size + items.den.size} items, game version ${items.deployVersion}).` }))
      .catch((e) => log({ type: 'warn', message: `Item names didn't load: ${e.message}` }))
    loadItems()
    // Try again once the game has logged in (then JR knows the exact game version).
    gameServer.once('session', () => { if (!items.ready) setTimeout(loadItems, 3000) })
    if (settings.openGameOnStart) play().catch(e => log({ type: 'error', message: e.message }))
  }

  async function shutdown () {
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
    openPlugin,
    play,
    stopGame,
    start,
    shutdown,
    lock,
    log
  }
}
