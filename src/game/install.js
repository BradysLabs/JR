'use strict'

/**
 * JR's copy of AJ Classic.
 *
 * JR never ships WildWorks' files. Instead, on the user's computer, it copies
 * the official AJ Classic install into JR's own folder and makes three small
 * changes to that copy:
 *
 *   config.js       turn off the copy's auto-updater (the official install
 *                   keeps updating itself as normal)
 *   index.js        read --jr-api and --jr-user-data, so each JR profile has
 *                   its own game login data and knows where JR is
 *   GameScreen.js   before the game starts, ask JR which server address to
 *                   use (JR's proxy) instead of Animal Jam's
 *
 * When the official install changes version, JR rebuilds its copy.
 */

const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const fs = (() => { try { return require('original-fs') } catch (_) { return require('fs') } })()
const asar = require('./asar')

const PATCH_VERSION = 1
const EXE = 'AJ Classic.exe'

/** Where the official AJ Classic is usually installed. */
function findOfficial () {
  const candidates = []
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'aj-classic'))
  candidates.push(path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'aj-classic'))
  if (process.env.PROGRAMFILES) candidates.push(path.join(process.env.PROGRAMFILES, 'AJ Classic'))
  return candidates.find(dir => fs.existsSync(path.join(dir, EXE)) && fs.existsSync(path.join(dir, 'resources', 'app.asar'))) || null
}

/* ---------------------------------------------------------------- patches */

const JR_INDEX = `
;(() => {
  // Added by JR (BradysLabs): lets JR run this copy for a JR profile.
  const arg = (name) => {
    const hit = process.argv.find(a => a.startsWith('--' + name + '='))
    return hit ? hit.slice(name.length + 3) : null
  }
  config.jrApi = arg('jr-api')
  const userData = arg('jr-user-data')
  if (userData) app.setPath('userData', userData)
})();
`

const JR_GAME_SCREEN = `
// Added by JR (BradysLabs): asks JR for the address of its game proxy.
window.jrPrepare = async (flashVars) => {
  const api = globals.config && globals.config.jrApi
  if (!api) return flashVars
  const wanted = /^(smartfoxServer\\d*|smartfoxPort|blueboxServer\\d*|blueboxPort|ingressXt|ingressHProxy|content|clientURL|mdUrl|deploy_version|website)$/
  const send = {}
  for (const key of Object.keys(flashVars)) if (wanted.test(key)) send[key] = flashVars[key]
  const response = await fetch(api + '/game/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(send)
  })
  if (!response.ok) throw new Error('JR answered ' + response.status)
  return Object.assign({}, flashVars, await response.json())
};
`

/** The edits, as exact text replacements. Fails loudly if AJ changed. */
const PATCHES = {
  'config.js': [
    ['noUpdater: false', 'noUpdater: true']
  ],
  'index.js': [
    ['const config = require("./config.js");', 'const config = require("./config.js");' + JR_INDEX]
  ],
  'gui/components/GameScreen.js': [
    ['"use strict";', '"use strict";\n' + JR_GAME_SCREEN],
    [
      'this.webViewElem.send("flashVarsReady", flashVars);',
      'window.jrPrepare(flashVars).then(fv => this.webViewElem.send("flashVarsReady", fv)).catch(err => globals.genericError("JR could not start the game: " + err.message));'
    ]
  ]
}

function applyPatches (file, text) {
  for (const [find, replace] of PATCHES[file] || []) {
    const at = text.indexOf(find)
    if (at === -1 || text.indexOf(find, at + 1) !== -1) {
      throw new Error(`AJ Classic has changed (${file}). JR needs an update to support this version.`)
    }
    text = text.slice(0, at) + replace + text.slice(at + find.length)
  }
  return text
}

/** Reads the official app.asar and returns the patched files. */
function patchedArchive (officialAsar) {
  const archive = asar.open(officialAsar)
  try {
    const files = []
    const executable = new Set()
    for (const p of archive.list()) {
      let data = archive.read(p)
      if (PATCHES[p]) data = Buffer.from(applyPatches(p, data.toString('utf8')), 'utf8')
      const e = archive.entry(p)
      if (e.executable) executable.add(p)
      files.push([p, data])
    }
    for (const p of Object.keys(PATCHES)) {
      if (!files.some(([q]) => q === p)) throw new Error(`AJ Classic has changed (${p} is missing).`)
    }
    return { files, executable }
  } finally {
    archive.close()
  }
}

/* ---------------------------------------------------------------- install */

function stampOf (officialDir) {
  const exe = fs.statSync(path.join(officialDir, EXE))
  const app = fs.statSync(path.join(officialDir, 'resources', 'app.asar'))
  return `${PATCH_VERSION}:${exe.size}:${Math.round(exe.mtimeMs)}:${app.size}:${Math.round(app.mtimeMs)}`
}

/**
 * Makes sure JR's copy of the game exists and matches the official install.
 * @param {{officialDir?: string, gameDir: string, log?: Function}} options
 * @returns {{gameDir: string, exe: string, rebuilt: boolean}}
 */
function ensureGame ({ officialDir = findOfficial(), gameDir, log = () => {} }) {
  if (!officialDir) {
    throw new Error('AJ Classic isn\'t installed. Install it from animaljam.com, then open JR again.')
  }
  const stampFile = path.join(gameDir, 'jr-game.json')
  const stamp = stampOf(officialDir)
  let current = null
  try { current = JSON.parse(fs.readFileSync(stampFile, 'utf8')).stamp } catch (_) {}
  const exe = path.join(gameDir, EXE)
  if (current === stamp && fs.existsSync(exe)) return { gameDir, exe, rebuilt: false }

  log({ type: 'notify', message: 'Setting up JR\'s copy of AJ Classic…' })
  const tmp = `${gameDir}.building`
  fs.rmSync(tmp, { recursive: true, force: true })
  copyDir(officialDir, tmp, (rel) => {
    const r = rel.replace(/\\/g, '/')
    return r !== 'resources/app.asar' && !r.startsWith('resources/app.asar.unpacked') && !/^Uninstall /i.test(r)
  })
  const { files, executable } = patchedArchive(path.join(officialDir, 'resources', 'app.asar'))
  asar.write(path.join(tmp, 'resources', 'app.asar'), files, { executable })
  fs.writeFileSync(path.join(tmp, 'jr-game.json'), JSON.stringify({ stamp, officialDir, builtAt: new Date().toISOString() }, null, 2))

  fs.rmSync(gameDir, { recursive: true, force: true })
  fs.renameSync(tmp, gameDir)
  log({ type: 'success', message: 'JR\'s copy of AJ Classic is ready.' })
  return { gameDir, exe, rebuilt: true }
}

function copyDir (from, to, keep, rel = '') {
  fs.mkdirSync(path.join(to, rel), { recursive: true })
  for (const e of fs.readdirSync(path.join(from, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name)
    if (!keep(r)) continue
    if (e.isDirectory()) copyDir(from, to, keep, r)
    else if (e.isFile()) fs.copyFileSync(path.join(from, r), path.join(to, r))
  }
}

/**
 * Starts JR's copy of the game for one profile.
 * @returns {import('child_process').ChildProcess}
 */
function launch ({ exe, apiUrl, userDataDir }) {
  fs.mkdirSync(userDataDir, { recursive: true })
  const child = spawn(exe, [`--jr-api=${apiUrl}`, `--jr-user-data=${userDataDir}`], {
    cwd: path.dirname(exe),
    detached: false,
    stdio: 'ignore',
    windowsHide: false
  })
  return child
}

module.exports = { findOfficial, ensureGame, launch, patchedArchive, applyPatches, PATCHES }
