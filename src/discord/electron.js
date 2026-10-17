/**
 * Electron glue for the Discord gate. Use from JR's main process:
 *
 *   const { createGate } = require('./discord-gate/electron')
 *   const gate = createGate({ clientId: '...', guildId: '...' })
 *   gate.on('change', ({ state, reason, user }) => win.webContents.send('gate', { state, reason, user }))
 *   await gate.start()                 // on launch
 *   ipcMain.handle('gate:sign-in', () => gate.signIn())
 *   ipcMain.handle('gate:check', () => gate.check())       // "I've joined, check again"
 *   ipcMain.handle('gate:sign-out', () => gate.signOut())
 *
 * The sign-in is saved encrypted with Electron's safeStorage (Windows DPAPI /
 * macOS Keychain), so other programs and other Windows users can't read it.
 * By default it's stored once per JR install, so every profile uses the same
 * Discord sign-in. Pass `file` to keep it per profile instead.
 */
const fs = require('fs')
const path = require('path')
const { app, shell, safeStorage } = require('electron')
const { DiscordGate } = require('./gate')

function encryptedFileStore (file) {
  return {
    async load () {
      try {
        const raw = fs.readFileSync(file)
        const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : null
        return json ? JSON.parse(json) : null
      } catch (_) {
        return null
      }
    },
    async save (session) {
      if (!safeStorage.isEncryptionAvailable()) return // never write the token in plain text
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(session)))
    },
    async clear () {
      try { fs.unlinkSync(file) } catch (_) {}
    }
  }
}

function createGate ({ clientId, guildId, requiredRoleId = null, file, ...rest }) {
  const target = file || path.join(app.getPath('userData'), 'discord-session.bin')
  return new DiscordGate({
    clientId,
    guildId,
    requiredRoleId,
    store: encryptedFileStore(target),
    openExternal: (url) => shell.openExternal(url),
    ...rest
  })
}

module.exports = { createGate, encryptedFileStore }
