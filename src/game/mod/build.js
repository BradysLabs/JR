'use strict'

/**
 * Builds JR's in-game version of the game file on this computer.
 *
 * JR's tools inside Animal Jam (its Settings rows, More Sorts, Pick a Color,
 * the Actions window's poses, the World Map tabs...) are changes to the game's
 * own code. WildWorks' game file can't be shared, so every player's JR makes
 * the change itself, from the game file their own computer downloads:
 *
 *   1. get the tools, once: JPEXS FFDec (decompiles and recompiles Flash
 *      games) and a Java runtime for it, from their official GitHub releases
 *   2. decompile the classes JR changes (edits.json "classes")
 *   3. apply JR's edits: each finds text in the game's code and replaces it
 *      (written in tools/game-mod/patch.py, recorded by record.py)
 *   4. compile them back into a copy of the game file
 *
 * The result is kept per game version and per edits.json, so it's made once
 * and again only when the game or JR's changes do. If anything goes wrong the
 * game keeps working without JR's in-game tools.
 */

const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
const fs = (() => { try { return require('original-fs') } catch (_) { return require('fs') } })()
const { request } = require('../http')

// Windows briefly locks files that were just written (antivirus scanning
// them, or Java/tar not quite letting go), and moving or deleting them then
// fails with EPERM/EBUSY/EACCES. A moment later it works.
const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'])
const RM = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/** Renames, waiting out a brief lock; last resort copies and deletes. */
async function move (from, to, { tries = 12, delay = 250 } = {}) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return } catch (error) {
      if (!LOCKED.has(error.code)) throw error
      if (i >= tries) break
      await sleep(delay * Math.min(i + 1, 4))
    }
  }
  fs.cpSync(from, to, { recursive: true, force: true })
  try { fs.rmSync(from, RM) } catch (_) {}
}

const FFDEC = {
  version: '26.4.0',
  url: 'https://github.com/jindrapetrik/jpexs-decompiler/releases/download/version26.4.0/ffdec_26.4.0.zip',
  bytes: 21917740
}
const JAVA_RELEASE = 'jdk-21.0.12%2B8'
const JAVA_FILE = '21.0.12_8'
const JAVA = {
  'win32-x64': `OpenJDK21U-jre_x64_windows_hotspot_${JAVA_FILE}.zip`,
  'win32-arm64': `OpenJDK21U-jre_x64_windows_hotspot_${JAVA_FILE}.zip`,
  'darwin-x64': `OpenJDK21U-jre_x64_mac_hotspot_${JAVA_FILE}.tar.gz`,
  'darwin-arm64': `OpenJDK21U-jre_aarch64_mac_hotspot_${JAVA_FILE}.tar.gz`
}
const javaUrl = (file) => `https://github.com/adoptium/temurin21-binaries/releases/download/${JAVA_RELEASE}/${file}`

// Names JR's edits add to the game; a finished build must have them.
const MUST_HAVE = ['jrAnchor', 'jrBigPalette', 'JRColorPicker', 'JRPictureMaker']

/** JR's recorded edits (src/game/mod/edits.json). */
function loadEdits (file = path.join(__dirname, 'edits.json')) {
  // plain fs: inside an installed JR this file is in app.asar
  return JSON.parse(require('fs').readFileSync(file, 'utf8'))
}

/**
 * Applies one file's edits to the game's decompiled script.
 * @returns {string}
 * @throws when the game's code isn't what the edits expect
 */
function applySteps (rel, text, steps) {
  let s = String(text).replace(/\r\n/g, '\n')
  for (const step of steps) {
    const n = s.split(step.find).length - 1
    if (n !== step.count) {
      const line = step.find.split('\n').find(l => l.trim()) || ''
      throw new Error(`${rel}: expected ${step.count} match, found ${n} (${line.trim().slice(0, 60)})`)
    }
    s = s.split(step.find).join(step.replace)
  }
  return s
}

/** Runs a program; resolves with its output, rejects with it on failure. */
function run (cmd, args, { cwd, timeout = 15 * 60 * 1000, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let out = ''
    const child = spawnImpl(cmd, args, { cwd, windowsHide: true })
    const timer = setTimeout(() => { try { child.kill() } catch (_) {} ; reject(new Error(`${path.basename(cmd)} took too long`)) }, timeout)
    const keep = (d) => { out = (out + d).slice(-20000) }
    if (child.stdout) child.stdout.on('data', keep)
    if (child.stderr) child.stderr.on('data', keep)
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`${path.basename(cmd)} stopped (${code}): ${out.trim().split('\n').slice(-3).join(' ')}`))
    })
  })
}

function findFile (dir, test, depth = 6) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return null }
  for (const e of entries) if (e.isFile() && test(path.join(dir, e.name))) return path.join(dir, e.name)
  if (depth <= 0) return null
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const hit = findFile(path.join(dir, e.name), test, depth - 1)
    if (hit) return hit
  }
  return null
}

/**
 * @param {object} options
 * @param {string} options.toolsDir where FFDec and Java are kept (shared by all profiles)
 * @param {string} options.outDir where finished builds go
 * @param {(e: {type: string, message: string}) => void} [options.log]
 * @param {object} [options.edits] JR's recorded edits (default: edits.json)
 * @param {() => Promise<{java: string, ffdec: string}>} [options.getTools] use these instead of downloading
 */
function createModBuilder ({ toolsDir, outDir, log = () => {}, edits = null, http = request, platform = process.platform, arch = process.arch, spawnImpl = spawn, runImpl = null, getTools = null }) {
  const E = edits || loadEdits()
  const exec = runImpl || ((cmd, args, o = {}) => run(cmd, args, { ...o, spawnImpl }))
  const jobs = new Map()
  const failed = new Map()

  const nameOf = (version, antiIdle) => `ajclient-${version}${antiIdle ? '-awake' : ''}-${E.id}.swf`

  /** A finished build for this game version, or null. */
  function file (version, antiIdle) {
    const f = path.join(outDir, nameOf(version, antiIdle))
    return fs.existsSync(f) ? f : null
  }

  async function download (url, to, expected) {
    const res = await http(url, { timeout: 120000, redirects: 8 })
    if (!res.ok) throw new Error(`download failed (${res.status}) for ${path.basename(to)}`)
    await new Promise((resolve, reject) => {
      const outStream = fs.createWriteStream(to)
      res.stream.on('error', reject)
      outStream.on('error', reject)
      outStream.on('finish', resolve)
      res.stream.pipe(outStream)
    })
    const size = fs.statSync(to).size
    if (expected && size !== expected) throw new Error(`download of ${path.basename(to)} was cut off`)
  }

  /** Downloads and unpacks an archive into toolsDir/<name> once. */
  async function unpacked (name, url, archiveName, expected, check) {
    const dir = path.join(toolsDir, name)
    const found = check(dir)
    if (found) return found
    log({ type: 'notify', message: `Downloading ${name.replace(/-.*/, '') === 'java' ? 'Java' : 'FFDec'} for JR\u2019s in-game features (first time only)\u2026` })
    fs.mkdirSync(toolsDir, { recursive: true })
    const tmp = `${dir}.part`
    fs.rmSync(tmp, RM)
    fs.mkdirSync(tmp, { recursive: true })
    const archive = path.join(toolsDir, archiveName)
    try {
      await download(url, archive, expected)
      // Windows 10+ and macOS both have tar, and it reads .zip too.
      await exec('tar', ['-xf', archive, '-C', tmp])
    } finally {
      try { fs.rmSync(archive, RM) } catch (_) {}
    }
    fs.rmSync(dir, RM)
    await move(tmp, dir)
    const hit = check(dir)
    if (!hit) throw new Error(`${name} didn't unpack as expected`)
    return hit
  }

  async function tools () {
    const key = `${platform}-${arch}`
    const jre = JAVA[key]
    if (!jre) throw new Error(`no Java download for ${key}`)
    const javaName = platform === 'win32' ? 'java.exe' : 'java'
    const java = await unpacked(`java-${JAVA_FILE}`, javaUrl(jre), jre, null,
      (dir) => findFile(dir, (f) => path.basename(f) === javaName && path.basename(path.dirname(f)) === 'bin'))
    if (platform !== 'win32') { try { fs.chmodSync(java, 0o755) } catch (_) {} }
    const ffdec = await unpacked(`ffdec-${FFDEC.version}`, FFDEC.url, `ffdec_${FFDEC.version}.zip`, FFDEC.bytes,
      (dir) => { const f = path.join(dir, 'ffdec-cli.jar'); return fs.existsSync(f) && fs.existsSync(path.join(dir, 'ffdec.jar')) ? f : null })
    return { java, ffdec }
  }

  async function make ({ version, antiIdle, baseFile }) {
    const out = path.join(outDir, nameOf(version, antiIdle))
    const work = path.join(outDir, `work-${version}${antiIdle ? '-awake' : ''}-${crypto.randomBytes(3).toString('hex')}`)
    const { java, ffdec } = await (getTools || tools)()
    log({ type: 'notify', message: `Building JR's in-game features for game version ${version}. This takes a minute or two…` })
    fs.mkdirSync(work, { recursive: true })
    try {
      const jvm = ['-Xmx2048m', '-Djava.awt.headless=true', '-jar', ffdec]
      await exec(java, [...jvm, '-onerror', 'ignore', '-selectclass', E.classes.join(','), '-export', 'script', path.join(work, 'src'), baseFile], { cwd: path.dirname(ffdec) })
      const scripts = path.join(work, 'src', 'scripts')
      for (const [rel, steps] of Object.entries(E.files)) {
        const from = path.join(scripts, ...rel.split('/'))
        if (!fs.existsSync(from)) throw new Error(`${rel} wasn't in the game file`)
        const text = applySteps(rel, fs.readFileSync(from, 'utf8'), steps)
        const to = path.join(work, 'mod', ...rel.split('/'))
        fs.mkdirSync(path.dirname(to), { recursive: true })
        fs.writeFileSync(to, text)
      }
      const tmp = path.join(work, 'out.swf')
      await exec(java, [...jvm, '-importScript', baseFile, tmp, path.join(work, 'mod')], { cwd: path.dirname(ffdec) })
      check(tmp)
      fs.mkdirSync(outDir, { recursive: true })
      await move(tmp, out)
      return out
    } finally {
      try { fs.rmSync(work, RM) } catch (_) {}
    }
  }

  /** The build must be a game file with JR's code compiled in. */
  function check (swfFile) {
    const buf = fs.readFileSync(swfFile)
    const { unpack } = require('../swf')
    const { body } = unpack(buf)
    const text = body.toString('latin1')
    const missing = MUST_HAVE.filter(n => !text.includes(n))
    if (missing.length) throw new Error(`the build is missing ${missing.join(', ')}`)
  }

  /**
   * Builds (once) for a game version. Resolves with the file, or null if it
   * couldn't be built (already reported in the log).
   * @param {{version: string, antiIdle: boolean, baseFile: string}} job
   */
  function build (job) {
    const key = `${job.version}${job.antiIdle ? '-awake' : ''}`
    const done = file(job.version, job.antiIdle)
    if (done) return Promise.resolve(done)
    if (jobs.has(key)) return jobs.get(key)
    if (failed.has(key)) return Promise.resolve(null)
    const p = (async () => {
      const lock = path.join(outDir, `${nameOf(job.version, job.antiIdle)}.lock`)
      fs.mkdirSync(outDir, { recursive: true })
      // Another JR profile may be building the same thing.
      for (let tries = 0; ; tries++) {
        try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); break } catch (_) {}
        let age = Infinity
        try { age = Date.now() - fs.statSync(lock).mtimeMs } catch (_) {}
        if (age > 20 * 60 * 1000) { try { fs.rmSync(lock, { force: true }) } catch (_) {} ; continue }
        if (tries > 240) throw new Error('another JR window is still building')
        await new Promise(resolve => setTimeout(resolve, 5000))
        const ready = file(job.version, job.antiIdle)
        if (ready) return ready
      }
      try {
        const ready = file(job.version, job.antiIdle)
        if (ready) return ready
        const out = await make(job)
        log({ type: 'success', message: 'JR’s in-game features are ready. Close the game and open it again to use them.' })
        return out
      } finally {
        try { fs.rmSync(lock, { force: true }) } catch (_) {}
      }
    })().catch((error) => {
      // A locked file is worth trying again next time the game opens.
      if (!LOCKED.has(error && error.code)) failed.set(key, error)
      log({ type: 'warn', message: `Couldn’t build JR’s in-game features: ${error.message}. The game still works without them.` })
      return null
    }).finally(() => jobs.delete(key))
    jobs.set(key, p)
    return p
  }

  return { file, build, id: E.id, tools, nameOf }
}

module.exports = { createModBuilder, applySteps, loadEdits, move, FFDEC, JAVA }
