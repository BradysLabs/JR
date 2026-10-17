const NodeBuffer = typeof Buffer !== 'undefined' ? Buffer : (typeof require === 'function' ? require('buffer').Buffer : null)
const WIDTH = 760
const HEIGHT = 460
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TYPES = {
  aja2id: { ext: 'ajart', label: 'Masterpiece (.ajart)' },
  ajg1id: { ext: 'ajgart', label: '.ajgart' }
}

function keysFor (uuid) {
  const key = NodeBuffer.alloc(16)
  const iv = NodeBuffer.alloc(16)
  for (let i = 0, c = 0; i < 16; i++) {
    key[i] = uuid.charCodeAt(c++)
    iv[i] = uuid.charCodeAt(c++)
  }
  return { key, iv }
}

function u29 (n) {
  if (n < 0x80) return [n]
  if (n < 0x4000) return [(n >> 7) | 0x80, n & 0x7f]
  if (n < 0x200000) return [(n >> 14) | 0x80, ((n >> 7) & 0x7f) | 0x80, n & 0x7f]
  return [(n >> 22) | 0x80, ((n >> 15) & 0x7f) | 0x80, ((n >> 8) & 0x7f) | 0x80, n & 0xff]
}

function amfString (s) {
  const bytes = NodeBuffer.from(s, 'utf8')
  return NodeBuffer.concat([NodeBuffer.from(u29((bytes.length << 1) | 1)), bytes])
}

function encodeAmf ({ b, h, p }) {
  return NodeBuffer.concat([
    NodeBuffer.from([0x09, 0x01]),
    amfString('b'), NodeBuffer.from([0x0C]), NodeBuffer.from(u29((b.length << 1) | 1)), b,
    amfString('h'), NodeBuffer.from([0x06]), amfString(h),
    amfString('p'), NodeBuffer.from([0x06]), amfString(p),
    amfString('')
  ])
}

function decodeAmf (buf) {
  let o = 0
  const strings = []
  const traits = []
  const byte = () => {
    if (o >= buf.length) throw new Error('This file is damaged.')
    return buf[o++]
  }
  const readU29 = () => {
    let r = 0
    for (let i = 0; i < 4; i++) {
      const b = byte()
      if (i < 3) {
        r = (r << 7) | (b & 0x7f)
        if (!(b & 0x80)) return r
      } else r = (r << 8) | b
    }
    return r >>> 0
  }
  const readStr = () => {
    const ref = readU29()
    if (!(ref & 1)) return strings[ref >> 1]
    const len = ref >> 1
    if (!len) return ''
    const s = buf.toString('utf8', o, o + len)
    o += len
    strings.push(s)
    return s
  }
  const readValue = () => {
    const m = byte()
    if (m === 0x00 || m === 0x01) return null
    if (m === 0x02) return false
    if (m === 0x03) return true
    if (m === 0x04) return readU29()
    if (m === 0x05) { const d = buf.readDoubleBE(o); o += 8; return d }
    if (m === 0x06) return readStr()
    if (m === 0x0C) {
      const len = readU29() >> 1
      const b = buf.subarray(o, o + len)
      o += len
      return b
    }
    if (m === 0x09) {
      const dense = readU29() >> 1
      const out = {}
      for (let k = readStr(); k !== ''; k = readStr()) out[k] = readValue()
      for (let i = 0; i < dense; i++) out[i] = readValue()
      return out
    }
    if (m === 0x0A) {
      const ref = readU29()
      let t
      if (!(ref & 2)) t = traits[ref >> 2]
      else {
        t = { dynamic: !!(ref & 8), sealed: [] }
        readStr()
        for (let i = 0; i < ref >> 4; i++) t.sealed.push(readStr())
        traits.push(t)
      }
      const out = {}
      for (const k of t.sealed) out[k] = readValue()
      if (t.dynamic) for (let k = readStr(); k !== ''; k = readStr()) out[k] = readValue()
      return out
    }
    throw new Error('This file uses a format this tool does not understand.')
  }
  return readValue()
}

function encode (jpeg, uuid, type = 'aja2id') {
  if (!UUID_RE.test(uuid)) throw new Error('That is not a valid player uuid.')
  const zlib = require('zlib')
  const crypto = require('crypto')
  const packed = zlib.deflateSync(encodeAmf({ b: jpeg, h: type, p: uuid }), { level: 9 })
  const { key, iv } = keysFor(uuid)
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv)
  return NodeBuffer.concat([cipher.update(packed), cipher.final()])
}

function decode (file, uuid) {
  if (!UUID_RE.test(uuid)) throw new Error('That is not a valid player uuid.')
  const zlib = require('zlib')
  const crypto = require('crypto')
  const { key, iv } = keysFor(uuid)
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv).setAutoPadding(false)
  const decrypted = NodeBuffer.concat([decipher.update(file), decipher.final()])
  let inflated
  try {
    inflated = zlib.inflateSync(decrypted)
  } catch (_) {
    throw new Error('Could not unlock this file. It was probably made with a different uuid.')
  }
  const data = decodeAmf(inflated)
  if (!data || !data.b) throw new Error('This file has no image inside.')
  return { image: NodeBuffer.from(data.b), type: data.h, uuid: data.p }
}

if (typeof module !== 'undefined') module.exports = { encode, decode, encodeAmf, decodeAmf, keysFor, UUID_RE, TYPES, WIDTH, HEIGHT }
