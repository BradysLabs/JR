'use strict'

/**
 * Item pictures, drawn by the game itself: exactly what each item looks like
 * in your inventory, for any clothing item (in any color) or den item (in
 * any version).
 *
 * JR asks the game for pictures it doesn't have yet:
 *   JR -> game   "i"  {q: [{key, k: 'c'|'d', id, c?, v?}]}
 * and the game draws each one and answers, one message per picture:
 *   game -> JR   %xt%o%jr%-1%i%<key>%<PNG, base64>%<versions>%
 * versions: how many versions a den item has (0 for clothing).
 * Pictures are kept on disk, so each one is drawn once.
 */

const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')
const { pathToFileURL } = require('url')

const BATCH = 6               // pictures asked for at once
const TIMEOUT = 20000         // a picture the game hasn't drawn by then is asked for again later
const MAX_QUEUE = 400         // newest requests win when someone scrolls fast

/** The file name for one picture: c<id>_<color> or d<id>_<version>. */
function pictureKey ({ kind, id, color = 0, version = 0 }) {
  const k = kind === 'den' ? 'd' : 'c'
  const extra = kind === 'den' ? (Number(version) || 0) : (Number(color) >>> 0)
  return `${k}${Number(id)}_${extra}`
}

class ItemPictures extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.dir                      where pictures are kept
   * @param {(kind: string, value: object) => void} o.send   to the game
   * @param {() => boolean} o.ready             whether the game can draw now
   */
  constructor ({ dir, send, ready = () => true }) {
    super()
    this.setMaxListeners(50)
    this.dir = dir
    this.send = send
    this.ready = ready
    this.queue = []            // [{key, k, id, c, v}]
    this.waiting = new Map()   // key -> asked at
    this.versions = this._readVersions()
  }

  /** The picture's file URL if JR has it, else null. */
  url (item) {
    const file = this.file(item)
    return fs.existsSync(file) ? pathToFileURL(file).href : null
  }

  file (item) { return path.join(this.dir, `${pictureKey(item)}.png`) }

  /** How many versions a den item has, once the game has drawn it (null before). */
  versionCount (id) {
    const n = this.versions[String(id)]
    return Number.isFinite(n) ? n : null
  }

  /**
   * Asks the game for the pictures in `items` JR doesn't have yet. The
   * newest asks go first. Returns how many were queued.
   */
  request (items) {
    let added = 0
    const fresh = []
    for (const item of items || []) {
      if (!item || !Number.isFinite(Number(item.id))) continue
      const key = pictureKey(item)
      if (fresh.some(q => q.key === key) || this.waiting.has(key) || fs.existsSync(path.join(this.dir, `${key}.png`))) continue
      const at = this.queue.findIndex(q => q.key === key)
      if (at !== -1) this.queue.splice(at, 1)
      fresh.push(item.kind === 'den'
        ? { key, k: 'd', id: Number(item.id), v: Number(item.version) || 0 }
        : { key, k: 'c', id: Number(item.id), c: Number(item.color) >>> 0 })
      added++
    }
    this.queue.unshift(...fresh)
    if (this.queue.length > MAX_QUEUE) this.queue.length = MAX_QUEUE
    this.pump()
    return added
  }

  /** Sends the next few asks, if the game can draw and isn't busy. */
  pump () {
    const now = Date.now()
    for (const [key, at] of this.waiting) if (now - at > TIMEOUT) this.waiting.delete(key)
    if (!this.queue.length || this.waiting.size >= BATCH || !this.ready()) return
    const batch = this.queue.splice(0, BATCH - this.waiting.size)
    for (const q of batch) this.waiting.set(q.key, now)
    try { this.send('i', { q: batch }) } catch (_) { for (const q of batch) this.waiting.delete(q.key) }
  }

  /** A picture from the game. */
  receive (key, base64, versions) {
    key = String(key || '')
    this.waiting.delete(key)
    if (!/^[cd]\d+_\d+$/.test(key)) return
    if (base64 && base64 !== '-') {
      const png = Buffer.from(String(base64), 'base64')
      // Only keep real PNGs.
      if (png.length > 8 && png.readUInt32BE(0) === 0x89504e47) {
        try {
          fs.mkdirSync(this.dir, { recursive: true })
          fs.writeFileSync(path.join(this.dir, `${key}.png`), png)
        } catch (_) {}
      }
    }
    if (key[0] === 'd' && /^\d+$/.test(String(versions))) {
      const id = key.slice(1).split('_')[0]
      if (this.versions[id] !== Number(versions)) {
        this.versions[id] = Number(versions)
        this._saveVersions()
      }
    }
    const file = path.join(this.dir, `${key}.png`)
    this.emit('picture', key, fs.existsSync(file) ? pathToFileURL(file).href : null)
    this.pump()
  }

  _readVersions () {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, 'versions.json'), 'utf8')) || {} } catch (_) { return {} }
  }

  _saveVersions () {
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      fs.writeFileSync(path.join(this.dir, 'versions.json'), JSON.stringify(this.versions))
    } catch (_) {}
  }
}

module.exports = { ItemPictures, pictureKey }
