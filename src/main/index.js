'use strict'

/**
 * JR main process.
 *
 * Startup window: checks Discord membership, then lets the user pick a
 * profile. Each profile opens in its own window with its own browser session
 * (so plugin data and logins never overlap) and runs its own game proxy.
 */

const path = require('path')
const fs = require('fs')
const { app, BrowserWindow, ipcMain, protocol, session, shell, net, Menu, dialog, Notification } = require('electron')
const { pathToFileURL } = require('url')
const config = require('../config')
const { ProfileStore } = require('../profiles/store')
const { ensureGame } = require('../game/install')
const qol = require('../ui/qol')

const ROOT = path.join(__dirname, '..', '..')
const UI = path.join(ROOT, 'src', 'ui')
const ASSETS = path.join(ROOT, 'assets')
const isDev = !app.isPackaged

app.setName('JR')
app.setAppUserModelId('com.bradyslabs.jr')
const isMac = process.platform === 'darwin'
// Windows: no menu bar. Mac: the standard app, Edit and Window menus, which
// is also what makes Cmd+C, Cmd+V, Cmd+Q and Cmd+W work.
Menu.setApplicationMenu(isMac
  ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
  : null)

// app://assets/... serves JR's stylesheet and helper script to plugin windows.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showPicker())
  app.whenReady().then(start)
}

const profiles = new ProfileStore(app.getPath('userData'))
const profileWindows = new Map() // profile id -> { win, release }
let picker = null
let gate = null

/* -------------------------------------------------------- rich presence */

// Shows JR on the user's Discord profile, with a button to join the JR server.
const { Presence, activityFor } = require('../discord/presence')
const presence = new Presence({ clientId: config.discord.clientId })
const presenceStates = new Map() // webContents id -> { connected, playing, room }
const presenceStartedAt = Date.now()
function updatePresence () {
  presence.set(activityFor([...presenceStates.values()], { invite: config.discord.invite, startedAt: presenceStartedAt }))
}

/* ------------------------------------------------------------- protocol */

function serveAssets (ses) {
  if (ses.__jrAssets) return
  ses.__jrAssets = true
  ses.protocol.handle('app', (request) => {
    const url = new URL(request.url)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const base = url.host === 'assets' ? ASSETS : null
    const file = base && path.resolve(base, rel)
    if (!file || !file.startsWith(base + path.sep) || !fs.existsSync(file)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

/* ----------------------------------------------------------------- gate */

function createGate () {
  const { clientId, guildId, requiredRoleId } = config.discord
  if (!clientId || !guildId) return null
  const { createGate } = require('../discord/electron')
  const g = createGate({ clientId, guildId, requiredRoleId })
  g.on('change', (info) => {
    broadcast('gate', info)
    if (info.state === 'not-member' || info.state === 'signed-out') {
      // Lost membership: lock every open profile.
      for (const { win } of profileWindows.values()) win.webContents.send('gate', info)
    }
  })
  return g
}

function gateInfo () {
  if (!gate) return { state: 'member', disabled: true, user: null }
  return { state: gate.state, reason: gate.reason, user: gate.user }
}

/* --------------------------------------------------------------- windows */

// Windows draws its own title bar buttons (frameless). Mac keeps its own
// red/yellow/green buttons, placed over JR's title bar.
const WINDOW_BASE = {
  backgroundColor: '#0b0b0c',
  show: false,
  icon: path.join(ASSETS, 'icon.png'),
  ...(isMac ? { titleBarStyle: 'hidden' } : { frame: false })
}
const macButtons = (x, y = 14) => (isMac ? { trafficLightPosition: { x, y } } : {})

function showPicker () {
  if (picker && !picker.isDestroyed()) {
    if (picker.isMinimized()) picker.restore()
    picker.show()
    picker.focus()
    return
  }
  picker = new BrowserWindow({
    ...WINDOW_BASE,
    ...macButtons(16),
    width: 840,
    height: 645,
    resizable: false,
    maximizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload-picker.js'), contextIsolation: true, nodeIntegration: false }
  })
  picker.loadFile(path.join(UI, 'picker.html'))
  picker.once('ready-to-show', () => picker.show())
  picker.on('closed', () => {
    picker = null
    if (!profileWindows.size) app.quit()
  })
}

function openProfile (id) {
  if (gate && !gate.unlocked) throw new Error('Sign in with Discord first.')
  const existing = profileWindows.get(id)
  if (existing) {
    existing.win.show()
    existing.win.focus()
    return { focused: true }
  }
  const release = profiles.open(id) // throws if another JR has it open
  const profile = profiles.get(id)
  const partition = `persist:jr-${id}`
  const ses = session.fromPartition(partition)
  serveAssets(ses)

  const prefs = {
    partition,
    nodeIntegration: true,
    contextIsolation: false,
    sandbox: false,
    backgroundThrottling: false,
    spellcheck: false
  }
  // Reopen where this profile's window was last time.
  const saved = (appSettings().windowBounds || {})[id]
  // Mac buttons sit just right of the side rail, in the title bar.
  const win = new BrowserWindow({ ...WINDOW_BASE, ...macButtons(76), width: 1100, height: 720, ...placement(saved), minWidth: 860, minHeight: 600, title: `JR · ${profile.name}`, webPreferences: prefs })
  win.loadFile(path.join(UI, 'app.html'), { query: { profile: id } })
  win.once('ready-to-show', () => { if (saved && saved.maximized) win.maximize(); win.show() })
  win.on('close', () => rememberBounds(id, win))

  // Plugin windows: same session and powers as the profile window, so
  // plugins keep using window.jam and Node like they did in Jam Reborn.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('file:')) {
      if (/^https?:/.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 520,
        height: 640,
        backgroundColor: '#0b0b0c',
        autoHideMenuBar: true,
        icon: path.join(ASSETS, 'icon.png'),
        webPreferences: prefs
      }
    }
  })
  win.webContents.on('did-create-window', (child, details) => {
    child.setMenu(null)
    // A plugin window's uncaught errors (including failed async code, which
    // the page itself never sees) go to the profile window to show the user.
    const pluginId = String((details && details.frameName) || '').replace(/^jr-plugin-/, '')
    child.webContents.on('console-message', (event, level, message) => {
      // Electron 35+ passes one event object; older versions pass the values.
      const text = typeof message === 'string' ? message : event && event.message
      const isError = typeof level === 'number' ? level >= 3 : event && event.level === 'error'
      if (!pluginId || !isError || !/^Uncaught\b/.test(String(text))) return
      if (!win.isDestroyed()) win.webContents.send('jr:plugin-error', { id: pluginId, message: qol.cleanError(text) })
    })
    child.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
  })

  win.on('closed', () => {
    profileWindows.delete(id)
    release()
    if (!profileWindows.size && !picker) app.quit()
  })
  profileWindows.set(id, { win, release, profile })
  return { opened: true }
}

/** Window size and position from last time, if it still fits on a screen. */
function placement (saved) {
  if (!saved) return {}
  try {
    const { screen } = require('electron')
    const area = screen.getDisplayMatching({ x: Math.round(saved.x) || 0, y: Math.round(saved.y) || 0, width: Math.round(saved.width) || 1, height: Math.round(saved.height) || 1 }).workArea
    return qol.placeWindow(saved, area)
  } catch (_) {
    return {}
  }
}

function rememberBounds (id, win) {
  try {
    const all = appSettings().windowBounds || {}
    all[id] = { ...win.getNormalBounds(), maximized: win.isMaximized() }
    saveAppSettings({ windowBounds: all })
  } catch (_) {}
}

function broadcast (channel, data) {
  if (picker && !picker.isDestroyed()) picker.webContents.send(channel, data)
}

/* ------------------------------------------------------------------- ipc */

function handle (channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, value: await fn(event, ...args) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
}

let gameJob = null
function prepareGame (log) {
  // One build at a time, shared by every profile.
  if (!gameJob) {
    gameJob = Promise.resolve().then(() => ensureGame({ gameDir: path.join(app.getPath('userData'), 'game'), log }))
      .finally(() => { gameJob = null })
  }
  return gameJob
}

const appFile = () => path.join(app.getPath('userData'), 'app.json')
function appSettings () { try { return JSON.parse(fs.readFileSync(appFile(), 'utf8')) } catch (_) { return {} } }
function saveAppSettings (patch) {
  const next = { ...appSettings(), ...patch }
  fs.mkdirSync(path.dirname(appFile()), { recursive: true })
  fs.writeFileSync(appFile(), JSON.stringify(next, null, 2))
  return next
}

function registerIpc () {
  handle('jr:boot', () => ({ platform: process.platform, version: app.getVersion(), gate: gateInfo(), invite: config.discord.invite, skipWarning: !!appSettings().skipWarning }))
  handle('warning:accept', (e, dontShowAgain) => { if (dontShowAgain) saveAppSettings({ skipWarning: true, warningAcceptedAt: new Date().toISOString() }) })
  handle('gate:start', async () => { if (gate) await gate.start(); return gateInfo() })
  handle('gate:sign-in', async () => { if (gate) await gate.signIn(); return gateInfo() })
  handle('gate:check', async () => { if (gate) await gate.check(); return gateInfo() })
  handle('gate:sign-out', async () => { if (gate) await gate.signOut(); return gateInfo() })

  handle('profiles:list', () => profiles.list())
  handle('profiles:create', (e, name, color) => profiles.create(name, { color }))
  handle('profiles:rename', (e, id, name) => profiles.rename(id, name))
  handle('profiles:remove', (e, id) => profiles.remove(id))
  handle('profiles:open', (e, id) => {
    const result = openProfile(id)
    if (picker && !picker.isDestroyed()) picker.close()
    return result
  })
  handle('picker:show', () => showPicker())

  ipcMain.on('presence', (event, state) => {
    const id = event.sender.id
    if (!presenceStates.has(id)) event.sender.once('destroyed', () => { presenceStates.delete(id); updatePresence() })
    presenceStates.set(id, { connected: !!(state && state.connected), playing: !!(state && state.playing), room: state && typeof state.room === 'string' ? state.room.slice(0, 60) : undefined })
    updatePresence()
  })
  handle('presence:enabled', (e, on) => { saveAppSettings({ richPresence: !!on }); presence.setEnabled(!!on); return !!on })

  // Report a bug: save the report where the user picks (Downloads by default).
  handle('bugreport:save', async (e, text, name) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const safe = String(name || 'JR-bug-report.txt').replace(/[^\w.-]+/g, '-')
    const result = await dialog.showSaveDialog(win, {
      title: 'Save bug report',
      defaultPath: path.join(app.getPath('downloads'), safe),
      filters: [{ name: 'Text file', extensions: ['txt'] }]
    })
    if (result.canceled || !result.filePath) return null
    fs.writeFileSync(result.filePath, String(text || ''), 'utf8')
    shell.showItemInFolder(result.filePath)
    return result.filePath
  })

  handle('open-url', (e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url) })
  handle('open-path', (e, p) => shell.openPath(p))

  // For profile windows (nodeIntegration): their profile folder and paths.
  ipcMain.on('jr:profile-info', (event, id) => {
    try {
      const profile = profiles.get(id)
      event.returnValue = {
        ok: true,
        profile,
        version: app.getVersion(),
        root: ROOT,
        dataDir: profiles.dirOf(id),
        userData: app.getPath('userData'),
        userPlugins: path.join(app.getPath('userData'), 'plugins'),
        cacheDir: path.join(app.getPath('userData'), 'jr-cache'),
        gate: gateInfo(),
        invite: config.discord.invite,
        richPresence: appSettings().richPresence !== false,
        packetsPerSecond: config.packetsPerSecond,
        isDev
      }
    } catch (error) {
      event.returnValue = { ok: false, error: error.message }
    }
  })
  handle('game:prepare', async (event) => {
    const send = (entry) => { if (!event.sender.isDestroyed()) event.sender.send('jr:log', entry) }
    return prepareGame(send)
  })

  // Window buttons for our frameless windows.
  ipcMain.on('win', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize())
    else if (action === 'close') win.close()
    else if (action === 'devtools') win.webContents.toggleDevTools()
    else if (action === 'focus') { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
  })
}

/* ----------------------------------------------------------------- start */

async function start () {
  serveAssets(session.defaultSession)
  gate = createGate()
  registerIpc()
  presence.setEnabled(appSettings().richPresence !== false)
  updatePresence()
  presence.start()
  showPicker()
  checkForUpdates()
}

/** Installed copies update themselves from GitHub Releases. */
function checkForUpdates () {
  if (isDev) return
  // Unsigned Mac apps can't update themselves, so tell the user instead.
  if (isMac) { checkForMacUpdate(); setInterval(checkForMacUpdate, 6 * 60 * 60 * 1000); return }
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.checkForUpdatesAndNotify().catch(() => {})
    setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 60 * 60 * 1000)
  } catch (_) {}
}

/** Mac: looks for a newer release on GitHub and offers the download. */
let macUpdateShown = null
async function checkForMacUpdate () {
  try {
    const response = await net.fetch(`https://api.github.com/repos/${config.github.owner}/${config.github.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    if (!response.ok) return
    const release = await response.json()
    const latest = String(release.tag_name || '').replace(/^v/, '')
    if (!isNewer(latest, app.getVersion()) || macUpdateShown === latest) return
    macUpdateShown = latest
    const note = new Notification({ title: `JR ${latest} is out`, body: 'Click to download it. Install it over this one; your profiles stay.' })
    note.on('click', () => shell.openExternal(release.html_url || `https://github.com/${config.github.owner}/${config.github.repo}/releases/latest`))
    note.show()
  } catch (_) {}
}

/** Whether version a (like "0.2.0") is newer than b. */
function isNewer (a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  }
  return false
}

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => presence.stop())
