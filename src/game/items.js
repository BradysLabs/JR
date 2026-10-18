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
const { request } = require('./http')

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
  // Usually the download is the compressed data itself (the game copies it
  // into a ByteArray, inflates it, then reads one AMF3 object).
  for (const inflate of [zlib.inflateRawSync, zlib.inflateSync]) {
    try { return readAmf3(inflate(buf)) } catch (_) {}
  }
  // Otherwise it may be wrapped as an AMF3 byte array first.
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
   * @param {typeof request} [options.request]
   */
  constructor ({ cacheDir, source = () => null, request: http = request }) {
    this.cacheDir = cacheDir
    this.source = source
    this.http = http
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
    const response = await this.http('https://www.animaljam.com/flashvars')
    if (!response.ok) throw new Error(`flashvars answered ${response.status}`)
    const fv = await response.json()
    if (!fv.deploy_version) throw new Error('No game version in flashvars')
    return String(fv.deploy_version)
  }

  /** Downloads and decodes one pack. */
  async fetchPack (version, id) {
    const url = `${this.contentBase()}${version}/defPacks/${packHash(String(id))}`
    const response = await this.http(url)
    if (!response.ok) throw new Error(`Item pack ${id} answered ${response.status}`)
    return decodePack(await response.buffer())
  }

  /**
   * The game's color palette: a list of 0xRRGGBB colors. An item color is
   * four palette positions packed into one number, one per color layer.
   */
  async fetchPalette (version) {
    const url = `${this.contentBase()}${version}/${packHash('paletteData')}`
    const response = await this.http(url)
    if (!response.ok) throw new Error(`Palette answered ${response.status}`)
    const buf = await response.buffer()
    const size = buf.readInt32BE(0)
    const out = []
    for (let i = 4; i + 4 <= 4 + size && i + 4 <= buf.length; i += 4) out.push(buf.readUInt32BE(i) & 0xFFFFFF)
    return out
  }

  /** The real colors (0xRRGGBB) of a clothing color value, one per layer. */
  layerColors (color) {
    const p = this.palette
    if (!p) return null
    const c = Number(color) >>> 0
    return [c >>> 24 & 0xFF, c >>> 16 & 0xFF, c >>> 8 & 0xFF, c & 0xFF].map(i => p[i])
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
    const hasLayerDefinitions = cached && Object.values(cached.clothing || {}).some(item => item.layerDefId !== undefined && item.layerDefId !== null && Number(item.layerDefId) > 0)
    if (cached && (hasLayerDefinitions || !version)) return this._apply(cached)
    if (!version) {
      if (cached) return this._apply(cached)
      throw new Error('Couldn\'t find the game version, and there are no saved item lists yet.')
    }
    try {
      const [strings, clothing, den] = await Promise.all([
        this.fetchPack(version, PACKS.strings),
        this.fetchPack(version, PACKS.clothing),
        this.fetchPack(version, PACKS.den)
      ])
      const data = {
        schema: 3,
        deployVersion: version,
        clothing: listOf(clothing, strings, 'titleStrId', 'value'),
        den: listOf(den, strings, 'nameStrId', 'cost'),
        palette: await this.fetchPalette(version).catch(() => null)
      }
      // A few raw entries, to help when the game's item format changes.
      try {
        fs.mkdirSync(this.cacheDir, { recursive: true })
        const sample = (pack) => (pack instanceof Map ? [...pack.values()] : Object.values(pack || {})).slice(0, 5)
        fs.writeFileSync(path.join(this.cacheDir, `items-sample-${version}.json`), JSON.stringify({ clothing: sample(clothing), den: sample(den) }, null, 1))
      } catch (_) {}
      this._writeCache(data)
      this._apply(data)
    } catch (error) {
      if (cached) return this._apply(cached)
      throw error
    }
  }

  _apply (data) {
    this.deployVersion = data.deployVersion
    this.palette = data.palette || null
    this.clothing = new Map(Object.entries(data.clothing || {}))
    this.den = new Map(Object.entries(data.den || {}))
    this.ready = true
  }

  _readCache (version) {
    try {
      if (version) {
        for (const schema of ['v3', 'v2']) {
          const f = path.join(this.cacheDir, `items-${schema}-${version}.json`)
          if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'))
        }
        return null
      }
      const newest = fs.readdirSync(this.cacheDir).filter(f => /^items-v[23]-.+\.json$/.test(f))
        .sort((a, b) => (parseInt(b.match(/items-v[23]-(.+)\.json$/)?.[1], 10) || 0) - (parseInt(a.match(/items-v[23]-(.+)\.json$/)?.[1], 10) || 0))[0]
      return newest ? JSON.parse(fs.readFileSync(path.join(this.cacheDir, newest), 'utf8')) : null
    } catch (_) {
      return null
    }
  }

  _writeCache (data) {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true })
      fs.writeFileSync(path.join(this.cacheDir, `items-v3-${data.deployVersion}.json`), JSON.stringify(data))
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
    const item = {
      name: lookup(e[nameKey]) || e.abbrName || null,
      cost: Number(e[costKey]) || 0,
      currency: Number(e.currencyType) === 1 ? 'diamonds' : 'gems',
      members: String(e.membersOnly) === '1'
    }
    if (e.layerId !== undefined && e.layerId !== null) item.layerId = Number(e.layerId)
    if (e.layerDefId !== undefined && e.layerDefId !== null) item.layerDefId = Number(e.layerDefId)
    // Clothing: the colors the item comes in, in shop order.
    if (e.colors !== undefined && e.colors !== null && String(e.colors) !== '') {
      item.colors = String(e.colors).split(',').map(c => Number(c) >>> 0)
    }
    if (e.specialType !== undefined) item.specialType = Number(e.specialType) || 0
    if (e.abbrName) item.abbr = String(e.abbrName)
    out[String(e.id)] = item
  }
  return out
}

module.exports = { ItemDatabase, packHash, decodePack, PACKS }
