'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { readJson, writeJson } = require('./files')

const COLORS = ['#ededee', '#a3a3a8', '#7dd3fc', '#86efac', '#fcd34d', '#f9a8d4', '#c4b5fd', '#fdba74']
const MAX_NAME = 24
const openHere = new Set() // profile folders this process has open

/**
 * JR profiles. Each profile is one JR window with its own folder:
 *
 *   <root>/profiles.json           the list of profiles
 *   <root>/profiles/<id>/          everything for one profile
 *     settings.json
 *     plugins.json                 which plugins this profile approved
 *     plugin-data/<plugin id>/     each plugin's saved data
 *     session/                     the profile's browser data (localStorage etc.)
 *     profile.lock                 present while a JR window has it open
 *
 * Nothing is shared between profile folders, so plugin data never overlaps.
 */
class ProfileStore {
  constructor (root) {
    this.root = root
    this.file = path.join(root, 'profiles.json')
  }

  list () {
    const data = readJson(this.file, null)
    const profiles = data && Array.isArray(data.profiles) ? data.profiles : []
    return profiles
      .map(p => ({ ...p, open: this.isOpen(p.id) }))
      .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
  }

  get (id) {
    return this._all().find(p => p.id === id) || null
  }

  /** Creates a profile. `name` is what the user typed. */
  create (name, { color } = {}) {
    name = checkName(name)
    const all = this._all()
    if (all.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`There's already a profile called "${name}".`)
    }
    const id = `${slug(name) || 'profile'}-${crypto.randomBytes(3).toString('hex')}`
    const profile = {
      id,
      name,
      color: color || COLORS[all.length % COLORS.length],
      createdAt: Date.now(),
      lastUsedAt: null
    }
    fs.mkdirSync(this.dirOf(id), { recursive: true })
    this._save([...all, profile])
    return profile
  }

  rename (id, name) {
    name = checkName(name)
    const all = this._all()
    const profile = all.find(p => p.id === id)
    if (!profile) throw new Error('That profile no longer exists.')
    if (all.some(p => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`There's already a profile called "${name}".`)
    }
    profile.name = name
    this._save(all)
    return profile
  }

  setColor (id, color) {
    const all = this._all()
    const profile = all.find(p => p.id === id)
    if (!profile) throw new Error('That profile no longer exists.')
    profile.color = String(color)
    this._save(all)
    return profile
  }

  /** Deletes a profile and all of its data. Refuses while it's open. */
  remove (id) {
    if (this.isOpen(id)) throw new Error('Close that profile\'s JR window first.')
    const all = this._all()
    if (!all.some(p => p.id === id)) return false
    this._save(all.filter(p => p.id !== id))
    fs.rmSync(this.dirOf(id), { recursive: true, force: true })
    return true
  }

  dirOf (id) {
    if (!/^[a-z0-9-]+$/.test(String(id))) throw new Error('Bad profile id')
    return path.join(this.root, 'profiles', id)
  }

  /**
   * Opens a profile in this process. Only one JR window can have a profile
   * open at a time. Returns a release function.
   */
  open (id) {
    const profile = this.get(id)
    if (!profile) throw new Error('That profile no longer exists.')
    const dir = this.dirOf(id)
    fs.mkdirSync(dir, { recursive: true })
    const lock = path.join(dir, 'profile.lock')
    if (openHere.has(dir)) throw new Error(`"${profile.name}" is already open in another JR window.`)

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.writeFileSync(lock, String(process.pid), { flag: 'wx' })
        break
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        const owner = Number(readText(lock))
        if (owner && owner !== process.pid && isRunning(owner) && isFresh(lock)) {
          throw new Error(`"${profile.name}" is already open in another JR window.`)
        }
        // Left behind by a JR that crashed (or by us): take it over.
        fs.rmSync(lock, { force: true })
        if (attempt === 1) throw error
      }
    }

    const all = this._all()
    const p = all.find(x => x.id === id)
    // Strictly newer than every other profile, even within the same millisecond.
    p.lastUsedAt = Math.max(Date.now(), ...all.map(x => (x.lastUsedAt || 0) + 1))
    this._save(all)

    openHere.add(dir)
    // Keep the lock fresh while it's open: a lock nobody refreshes was left
    // by a JR that was closed without cleaning up (e.g. Ctrl+C on npm start),
    // even if Windows has since given its process number to another program.
    const heartbeat = setInterval(() => {
      const now = new Date()
      try { if (Number(readText(lock)) === process.pid) fs.utimesSync(lock, now, now) } catch (_) {}
    }, LOCK_REFRESH)
    if (heartbeat.unref) heartbeat.unref()
    let released = false
    return () => {
      if (released) return
      released = true
      clearInterval(heartbeat)
      openHere.delete(dir)
      if (Number(readText(lock)) === process.pid) fs.rmSync(lock, { force: true })
    }
  }

  isOpen (id) {
    let lock
    try { lock = path.join(this.dirOf(id), 'profile.lock') } catch (_) { return false }
    const owner = Number(readText(lock))
    if (owner === process.pid) return openHere.has(path.dirname(lock))
    return !!owner && isRunning(owner) && isFresh(lock)
  }

  _all () {
    const data = readJson(this.file, null)
    return data && Array.isArray(data.profiles) ? data.profiles : []
  }

  _save (profiles) {
    writeJson(this.file, { version: 1, profiles })
  }
}

function checkName (name) {
  name = String(name || '').replace(/\s+/g, ' ').trim()
  if (!name) throw new Error('Give the profile a name.')
  if (name.length > MAX_NAME) throw new Error(`Profile names can be up to ${MAX_NAME} characters.`)
  return name
}

function slug (name) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20)
}

function readText (file) {
  try { return fs.readFileSync(file, 'utf8').trim() } catch (_) { return '' }
}

const LOCK_REFRESH = 10 * 1000 // how often an open profile refreshes its lock
const LOCK_STALE = 30 * 1000   // a lock not refreshed for this long was left behind

function isFresh (lock) {
  try { return Date.now() - fs.statSync(lock).mtimeMs < LOCK_STALE } catch (_) { return false }
}

function isRunning (pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

module.exports = { ProfileStore, COLORS, LOCK_STALE }
