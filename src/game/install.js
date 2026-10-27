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
 *
 * Windows: AJ Classic is a folder with "AJ Classic.exe" and resources/app.asar.
 * Mac: AJ Classic is "AJ Classic.app"; the archive is in Contents/Resources and
 * the program in Contents/MacOS. The Mac copy keeps the bundle's symlinks,
 * updates the archive's checksum in Info.plist, and is signed again "ad hoc"
 * (macOS won't open a changed app otherwise).
 */

const path = require('path')
const os = require('os')
const { spawn, spawnSync } = require('child_process')
const fs = (() => { try { return require('original-fs') } catch (_) { return require('fs') } })()
// JR's own files may sit inside JR's app.asar once installed; plain fs can read those.
const jrFs = require('fs')
const asar = require('./asar')

const PATCH_VERSION = 3
const EXE = 'AJ Classic.exe'
const MAC_APP = 'AJ Classic.app'

/**
 * Where things are inside an AJ Classic install, per platform.
 * resources: the folder holding app.asar; exe(root): the program to run.
 */
function layoutFor (platform = process.platform) {
  if (platform === 'darwin') {
    return {
      platform,
      resources: 'Contents/Resources',
      exe: (root) => path.join('Contents', 'MacOS', macExecutable(root)),
      copyRoot: (dir) => path.join(dir, MAC_APP) // the copy stays a .app bundle
    }
  }
  return { platform, resources: 'resources', exe: () => EXE, copyRoot: (dir) => dir }
}

/** The program name inside a Mac app, from its Info.plist (or the only file in Contents/MacOS). */
function macExecutable (appDir) {
  try {
    const plist = fs.readFileSync(path.join(appDir, 'Contents', 'Info.plist'), 'utf8')
    const m = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)
    if (m) return m[1]
  } catch (_) {}
  try {
    const files = fs.readdirSync(path.join(appDir, 'Contents', 'MacOS'))
    if (files.length) return files.includes('AJ Classic') ? 'AJ Classic' : files[0]
  } catch (_) {}
  return 'AJ Classic'
}

const isInstall = (dir, layout) => {
  try { return fs.existsSync(path.join(dir, layout.resources, 'app.asar')) && fs.existsSync(path.join(dir, layout.exe(dir))) } catch (_) { return false }
}

/** Where the official AJ Classic is usually installed. */
function findOfficial ({ platform = process.platform, env = process.env, home = os.homedir(), appFolders } = {}) {
  const layout = layoutFor(platform)
  const candidates = []
  if (platform === 'darwin') {
    // Usually /Applications/AJ Classic.app; also look for anything named like it.
    for (const folder of appFolders || ['/Applications', path.join(home, 'Applications')]) {
      candidates.push(path.join(folder, MAC_APP))
      try {
        for (const name of fs.readdirSync(folder)) {
          if (/\.app$/i.test(name) && /aj classic|animal jam/i.test(name) && name !== MAC_APP) candidates.push(path.join(folder, name))
        }
      } catch (_) {}
    }
  } else {
    if (env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, 'Programs', 'aj-classic'))
    candidates.push(path.join(home, 'AppData', 'Local', 'Programs', 'aj-classic'))
    if (env.PROGRAMFILES) candidates.push(path.join(env.PROGRAMFILES, 'AJ Classic'))
  }
  return candidates.find(dir => isInstall(dir, layout)) || null
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
  config.jrProfile = arg('jr-profile')
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
    ['const config = require("./config.js");', 'const config = require("./config.js");' + JR_INDEX],
    ['backgroundColor: "#F5C86D"', 'backgroundColor: "#0b0b0c"']
  ],
  'gui/index.html': [
    ['<title>Animal Jam Classic</title>', '<title>JR</title>\n    <script src="jr-skin.js"></script>']
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
    // JR's look: its skin script and its icon.
    const add = (p, data) => {
      const i = files.findIndex(([q]) => q === p)
      if (i === -1) files.push([p, data]); else files[i] = [p, data]
    }
    add('gui/jr-skin.js', jrFs.readFileSync(path.join(__dirname, 'skin', 'jr-skin.js')))
    const icon = path.join(__dirname, '..', '..', 'assets', 'icon.png')
    if (jrFs.existsSync(icon)) {
      add('gui/images/icon.png', jrFs.readFileSync(icon))
      add('gui/icon.png', jrFs.readFileSync(icon))
    }
    return { files, executable }
  } finally {
    archive.close()
  }
}

/* ---------------------------------------------------------------- install */

function stampOf (officialDir, layout = layoutFor()) {
  const exe = fs.statSync(path.join(officialDir, layout.exe(officialDir)))
  const app = fs.statSync(path.join(officialDir, layout.resources, 'app.asar'))
  return `${PATCH_VERSION}:${exe.size}:${Math.round(exe.mtimeMs)}:${app.size}:${Math.round(app.mtimeMs)}`
}

/** Runs a command; throws with its output if it fails. */
function runCommand (cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr || r.stdout || '').trim()}`)
  return r.stdout
}

/**
 * Electron checks app.asar against a checksum in the Mac app's Info.plist
 * (when the app turns that check on). Puts the new archive's checksum there.
 * @returns {boolean} whether a checksum was found and updated
 */
function updateAsarIntegrity (appDir, asarFile, run = runCommand) {
  const plistFile = path.join(appDir, 'Contents', 'Info.plist')
  if (!fs.existsSync(plistFile)) return false
  let text = fs.readFileSync(plistFile, 'utf8')
  if (!text.startsWith('<?xml') && !text.includes('<plist')) {
    run('plutil', ['-convert', 'xml1', plistFile]) // binary plist -> text
    text = fs.readFileSync(plistFile, 'utf8')
  }
  const re = /(<key>ElectronAsarIntegrity<\/key>\s*<dict>[\s\S]*?<key>Resources\/app\.asar<\/key>\s*<dict>[\s\S]*?<key>hash<\/key>\s*<string>)([0-9a-fA-F]+)(<\/string>)/
  if (!re.test(text)) return false
  fs.writeFileSync(plistFile, text.replace(re, `$1${asar.headerHash(asarFile)}$3`))
  return true
}

/** Lets macOS open the changed copy: clear the download flag and sign it ad hoc. */
function signMacCopy (appDir, run = runCommand) {
  try { run('xattr', ['-cr', appDir]) } catch (_) {}
  try {
    run('codesign', ['--force', '--deep', '--sign', '-', appDir])
  } catch (error) {
    throw new Error(`macOS wouldn't let JR prepare its copy of AJ Classic (${error.message}).`)
  }
}

/**
 * Makes sure JR's copy of the game exists and matches the official install.
 * @param {{officialDir?: string, gameDir: string, log?: Function}} options
 * @returns {{gameDir: string, exe: string, rebuilt: boolean}}
 */
function ensureGame ({ officialDir, gameDir, log = () => {}, platform = process.platform, run = runCommand }) {
  const layout = layoutFor(platform)
  if (officialDir === undefined) officialDir = findOfficial({ platform })
  if (!officialDir) {
    throw new Error(platform === 'darwin'
      ? 'AJ Classic isn\'t installed. Install it from animaljam.com (it goes in Applications), then open JR again.'
      : 'AJ Classic isn\'t installed. Install it from animaljam.com, then open JR again.')
  }
  const stampFile = path.join(gameDir, 'jr-game.json')
  const stamp = stampOf(officialDir, layout)
  let current = null
  try { current = JSON.parse(fs.readFileSync(stampFile, 'utf8')).stamp } catch (_) {}
  const exeRel = layout.exe(officialDir)
  const exe = path.join(layout.copyRoot(gameDir), exeRel)
  if (current === stamp && fs.existsSync(exe)) return { gameDir, exe, rebuilt: false }

  log({ type: 'notify', message: 'Setting up JR\'s copy of AJ Classic…' })
  const tmp = `${gameDir}.building`
  const root = layout.copyRoot(tmp)
  const res = layout.resources
  fs.rmSync(tmp, { recursive: true, force: true })
  copyDir(officialDir, root, (rel) => {
    const r = rel.replace(/\\/g, '/')
    return r !== `${res}/app.asar` && !r.startsWith(`${res}/app.asar.unpacked`) && !/^Uninstall /i.test(r)
  })
  const asarFile = path.join(root, res, 'app.asar')
  const { files, executable } = patchedArchive(path.join(officialDir, res, 'app.asar'))
  asar.write(asarFile, files, { executable })
  if (platform === 'darwin') {
    updateAsarIntegrity(root, asarFile, run)
    signMacCopy(root, run)
  }
  fs.writeFileSync(path.join(tmp, 'jr-game.json'), JSON.stringify({ stamp, officialDir, builtAt: new Date().toISOString() }, null, 2))

  fs.rmSync(gameDir, { recursive: true, force: true })
  fs.renameSync(tmp, gameDir)
  log({ type: 'success', message: 'JR\'s copy of AJ Classic is ready.' })
  return { gameDir, exe, rebuilt: true }
}

/** Copies a folder. Keeps symlinks as symlinks (Mac apps rely on them) and file permissions. */
function copyDir (from, to, keep, rel = '') {
  fs.mkdirSync(path.join(to, rel), { recursive: true })
  for (const e of fs.readdirSync(path.join(from, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name)
    if (!keep(r)) continue
    const src = path.join(from, r)
    const dest = path.join(to, r)
    if (e.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dest)
    else if (e.isDirectory()) copyDir(from, to, keep, r)
    else if (e.isFile()) {
      fs.copyFileSync(src, dest)
      try { fs.chmodSync(dest, fs.statSync(src).mode & 0o777) } catch (_) {}
    }
  }
}

/**
 * Starts JR's copy of the game for one profile.
 * @returns {import('child_process').ChildProcess}
 */
function launch ({ exe, apiUrl, userDataDir, profileName = '' }) {
  fs.mkdirSync(userDataDir, { recursive: true })
  const args = [`--jr-api=${apiUrl}`, `--jr-user-data=${userDataDir}`]
  if (profileName) args.push(`--jr-profile=${profileName}`)
  const child = spawn(exe, args, {
    cwd: path.dirname(exe),
    detached: false,
    stdio: 'ignore',
    windowsHide: false
  })
  return child
}

module.exports = { findOfficial, ensureGame, launch, patchedArchive, applyPatches, PATCHES, layoutFor, macExecutable, updateAsarIntegrity }
