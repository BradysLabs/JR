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
const { app, BrowserWindow, ipcMain, protocol, session, shell, net, Menu } = require('electron')
const { pathToFileURL } = require('url')
const config = require('../config')
const { ProfileStore } = require('../profiles/store')
const { ensureGame } = require('../game/install')

const ROOT = path.join(__dirname, '..', '..')
const UI = path.join(ROOT, 'src', 'ui')
const ASSETS = path.join(ROOT, 'assets')
const isDev = !app.isPackaged

app.setName('JR')
app.setAppUserModelId('com.bradyslabs.jr')
Menu.setApplicationMenu(null)

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

const WINDOW_BASE = {
  backgroundColor: '#0b0b0c',
  frame: false,
  show: false,
  icon: path.join(ASSETS, 'icon.png')
}

function showPicker () {
  if (picker && !picker.isDestroyed()) {
    if (picker.isMinimized()) picker.restore()
    picker.show()
    picker.focus()
    return
  }
  picker = new BrowserWindow({
    ...WINDOW_BASE,
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
  const win = new BrowserWindow({ ...WINDOW_BASE, width: 1100, height: 720, minWidth: 860, minHeight: 600, title: `JR · ${profile.name}`, webPreferences: prefs })
  win.loadFile(path.join(UI, 'app.html'), { query: { profile: id } })
  win.once('ready-to-show', () => win.show())

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
  win.webContents.on('did-create-window', (child) => {
    child.setMenu(null)
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

function registerIpc () {
  handle('jr:boot', () => ({ version: app.getVersion(), gate: gateInfo(), invite: config.discord.invite }))
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
        cacheDir: path.join(app.getPath('userData'), 'cache'),
        gate: gateInfo(),
        invite: config.discord.invite,
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
  })
}

/* ----------------------------------------------------------------- start */

async function start () {
  serveAssets(session.defaultSession)
  gate = createGate()
  registerIpc()
  showPicker()
}

app.on('window-all-closed', () => app.quit())
