'use strict'

/**
 * Changes text inside the game's definition packs (the files under
 * <content>/<version>/defPacks/) on their way to the game.
 *
 * A pack is one AMF3 value, compressed. JR doesn't rebuild the pack: it finds
 * the strings it wants to change and swaps just those bytes, so everything
 * else reaches the game exactly as Animal Jam sent it. Then it compresses
 * the result the same way the original was.
 *
 * Packs come in three wrappings (see decodePack in items.js):
 *   raw      raw deflate of the AMF3 data
 *   zlib     zlib deflate of the AMF3 data
 *   wrapped  an AMF3 byte array holding raw or zlib data
 */

const zlib = require('zlib')
const { Amf3Reader } = require('./amf3')

/** AMF3's variable-length integer, as bytes. */
function u29Bytes (n) {
  if (n < 0 || n > 0x1FFFFFFF) throw new Error(`Value out of AMF3 range: ${n}`)
  if (n < 0x80) return [n]
  if (n < 0x4000) return [(n >> 7) | 0x80, n & 0x7F]
  if (n < 0x200000) return [(n >> 14) | 0x80, ((n >> 7) & 0x7F) | 0x80, n & 0x7F]
  return [(n >> 22) | 0x80, ((n >> 15) & 0x7F) | 0x80, ((n >> 8) & 0x7F) | 0x80, n & 0xFF]
}

/** An inline AMF3 string: its length header, then its UTF-8 bytes. */
function inlineString (text) {
  const bytes = Buffer.from(text, 'utf8')
  return Buffer.concat([Buffer.from(u29Bytes((bytes.length << 1) | 1)), bytes])
}

/** Reads one AMF3 value and lists every inline string in it. Throws if it isn't AMF3. */
function scan (data) {
  const reader = new Amf3Reader(data)
  const spans = []
  reader.onString = (span) => spans.push(span)
  const value = reader.read()
  return { value, spans, end: reader.pos }
}

const METHODS = {
  raw: { inflate: zlib.inflateRawSync, deflate: zlib.deflateRawSync },
  zlib: { inflate: zlib.inflateSync, deflate: zlib.deflateSync }
}

/** Tries each compression on `buf`; returns { method, data, scanned } or null. */
function inflateAny (buf) {
  for (const method of ['raw', 'zlib']) {
    try {
      const data = METHODS[method].inflate(buf)
      return { method, data, scanned: scan(data) }
    } catch (_) {}
  }
  return null
}

/**
 * Opens a pack. Returns { wrap, method, data, scanned } or null when it isn't
 * a pack JR knows how to change (for example a JSON one).
 */
function openPack (buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return null
  if (buf[0] === 0x7B || buf[0] === 0x5B) return null // JSON
  const direct = inflateAny(buf)
  if (direct) return { wrap: null, ...direct }
  // Wrapped in an AMF3 byte array: 0x0C, then a length header, then the bytes.
  if (buf[0] === 0x0C) {
    const reader = new Amf3Reader(buf)
    reader.pos = 1
    const header = reader.u29()
    if (header & 1) {
      const length = header >> 1
      const inner = buf.subarray(reader.pos, reader.pos + length)
      const opened = inflateAny(inner)
      if (opened) return { wrap: { after: buf.subarray(reader.pos + length) }, ...opened }
    }
  }
  return null
}

/** Puts compressed bytes back in the same wrapping they came in. */
function closePack (pack, compressed) {
  if (!pack.wrap) return compressed
  return Buffer.concat([
    Buffer.from([0x0C, ...u29Bytes((compressed.length << 1) | 1)]),
    compressed,
    pack.wrap.after
  ])
}

/**
 * Changes strings inside a pack.
 * @param {Buffer} buf the pack as Animal Jam sent it
 * @param {(text: string) => (string|null|undefined)} edit returns new text,
 *   or null/undefined (or the same text) to leave it alone
 * @returns {{buf: Buffer, changed: number}} changed = how many strings were
 *   replaced; buf is the original when nothing changed or the pack is unknown
 */
function rewriteStrings (buf, edit) {
  const pack = openPack(buf)
  if (!pack) return { buf, changed: 0 }
  const { data, scanned } = pack
  const pieces = []
  let from = 0
  let changed = 0
  for (const span of scanned.spans) {
    const next = edit(span.value)
    // An empty string is never stored inline in AMF3 (it would shift every
    // later string reference), so it can't replace one.
    if (typeof next !== 'string' || next === '' || next === span.value) continue
    pieces.push(data.subarray(from, span.start), inlineString(next))
    from = span.end
    changed++
  }
  if (!changed) return { buf, changed: 0 }
  pieces.push(data.subarray(from))
  const out = Buffer.concat(pieces)
  return { buf: closePack(pack, METHODS[pack.method].deflate(out)), changed }
}

module.exports = { rewriteStrings, openPack, inlineString, u29Bytes }
