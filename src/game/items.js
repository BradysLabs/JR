'use strict'

/**
 * Animal Jam item names and prices, from the game's own item packs.
 *
 * The game loads packs from its content server at
 *   <content>/<deploy version>/defPacks/<hash of pack id>
 * where the hash is the game's own: shuffle "W3 7r4Ck h4X0r3rs" + id (even
 * characters appended, odd ones prepended), then MD5. Packs are AMF3: a byte
 * array that, once inflated, holds the item list.
 *
 * Lists are cached on disk per game version.
 */

const crypto = require('crypto')
const zlib = require('zlib')
const path = require('path')
const fs = require('fs')
const { readAmf3 } = require('./amf3')

const DEFAULT_CONTENT = 'https://ajcontent.akamaized.net/'
const PACKS = { strings: '10230', clothing: '1000', den: '1030' }

/** The file name the game uses for a pack or file id. */
function packHash (id) {
  const input = 'W3 7r4Ck h4X0r3rs' + id
  let out = ''
  for (let i = 0; i < input.length; i++) out = i % 2 === 0 ? out + input[i] : input[i] + out
  return crypto.createHash('md5').update(out, 'utf8').digest('hex')
}

/** Turns the raw bytes of a pack into its contents. */
function decodePack (buf) {
  const first = buf[0]
  if (first === 0x7B || first === 0x5B) return JSON.parse(buf.toString('utf8'))
  const outer = readAmf3(buf)
  const inner = Buffer.isBuffer(outer) ? outer : buf
  let raw
  try { raw = zlib.inflateRawSync(inner) } catch (_) { raw = zlib.inflateSync(inner) }
  return readAmf3(raw)
}

class ItemDatabase {
  /**
   * @param {object} options
   * @param {string} options.cacheDir
   * @param {() => ({content?: string, version?: string}|null)} [options.source] current game session
   * @param {typeof fetch} [options.fetch]
   */
  constructor ({ cacheDir, source = () => null, fetch: fetcher = globalThis.fetch }) {
    this.cacheDir = cacheDir
    this.source = source
    this.fetch = fetcher
    this.clothing = new Map()
    this.den = new Map()
    this.deployVersion = null
    this.ready = false
    this._loading = null
  }

  contentBase () {
    const s = this.source()
    return (s && s.content) || DEFAULT_CONTENT
  }

  async latestVersion () {
    const s = this.source()
    if (s && s.version) return String(s.version)
    const response = await this.fetch('https://www.animaljam.com/flashvars')
    if (!response.ok) throw new Error(`flashvars answered ${response.status}`)
    const fv = await response.json()
    if (!fv.deploy_version) throw new Error('No game version in flashvars')
    return String(fv.deploy_version)
  }

  /** Downloads and decodes one pack. */
  async fetchPack (version, id) {
    const url = `${this.contentBase()}${version}/defPacks/${packHash(String(id))}`
    const response = await this.fetch(url)
    if (!response.ok) throw new Error(`Item pack ${id} answered ${response.status}`)
    return decodePack(Buffer.from(await response.arrayBuffer()))
  }

  load () {
    if (!this._loading) this._loading = this._load().catch((error) => { this._loading = null; throw error })
    return this._loading
  }

  async refresh () {
    let latest
    try { latest = await this.latestVersion() } catch (_) { return false }
    if (latest === this.deployVersion) return false
    this._loading = null
    await this.load()
    return this.deployVersion === latest
  }

  async _load () {
    let version = null
    try { version = await this.latestVersion() } catch (_) {}
    const cached = this._readCache(version)
    if (cached) return this._apply(cached)
    if (!version) throw new Error('Couldn\'t find the game version, and there are no saved item lists yet.')
    const [strings, clothing, den] = await Promise.all([
      this.fetchPack(version, PACKS.strings),
      this.fetchPack(version, PACKS.clothing),
      this.fetchPack(version, PACKS.den)
    ])
    const data = {
      deployVersion: version,
      clothing: listOf(clothing, strings, 'titleStrId', 'value'),
      den: listOf(den, strings, 'nameStrId', 'cost')
    }
    this._writeCache(data)
    this._apply(data)
  }

  _apply (data) {
    this.deployVersion = data.deployVersion
    this.clothing = new Map(Object.entries(data.clothing || {}))
    this.den = new Map(Object.entries(data.den || {}))
    this.ready = true
  }

  _readCache (version) {
    try {
      if (version) {
        const f = path.join(this.cacheDir, `items-${version}.json`)
        return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null
      }
      const newest = fs.readdirSync(this.cacheDir).filter(f => /^items-.+\.json$/.test(f))
        .sort((a, b) => (parseInt(b.slice(6), 10) || 0) - (parseInt(a.slice(6), 10) || 0))[0]
      return newest ? JSON.parse(fs.readFileSync(path.join(this.cacheDir, newest), 'utf8')) : null
    } catch (_) {
      return null
    }
  }

  _writeCache (data) {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true })
      fs.writeFileSync(path.join(this.cacheDir, `items-${data.deployVersion}.json`), JSON.stringify(data))
    } catch (_) {}
  }

  getClothing (id) { return this.clothing.get(String(id)) || null }
  getDenItem (id) { return this.den.get(String(id)) || null }
  name (id, type = 'clothing') {
    const item = type === 'den' ? this.getDenItem(id) : this.getClothing(id)
    return item ? item.name : null
  }
}

function listOf (pack, strings, nameKey, costKey) {
  const out = {}
  const lookup = (strId) => {
    if (strId === undefined || strId === null || !strings) return null
    if (strings instanceof Map) return strings.get(strId) || strings.get(String(strId)) || null
    return strings[strId] || null
  }
  const entries = pack instanceof Map ? [...pack.values()] : Object.values(pack || {})
  for (const e of entries) {
    if (!e || e.id === undefined) continue
    out[String(e.id)] = {
      name: lookup(e[nameKey]) || e.abbrName || null,
      cost: Number(e[costKey]) || 0,
      currency: Number(e.currencyType) === 1 ? 'diamonds' : 'gems',
      members: String(e.membersOnly) === '1'
    }
  }
  return out
}

module.exports = { ItemDatabase, packHash, decodePack, PACKS }
