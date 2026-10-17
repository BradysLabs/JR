'use strict'

/**
 * Patches the Animal Jam game file (ajclient.swf) on the user's computer so
 * the game talks to JR without TLS. JR then makes the TLS connection to
 * Animal Jam itself.
 *
 * The game decides with SmartFoxClient.useSecureMode(). JR rewrites that
 * method's bytecode to "return false" and leaves everything else alone.
 */

const zlib = require('zlib')
const lzma = require('./lzma')

/** Returns the uncompressed SWF body (everything after the 8-byte header) and the version. */
function unpack (swf) {
  const sig = swf.toString('latin1', 0, 3)
  const version = swf[3]
  const length = swf.readUInt32LE(4)
  if (sig === 'FWS') return { version, body: swf.subarray(8, length) }
  if (sig === 'CWS') return { version, body: zlib.inflateSync(swf.subarray(8)).subarray(0, length - 8) }
  if (sig === 'ZWS') return { version, body: lzma.decode(swf.subarray(12, 17), swf, 17, length - 8) }
  throw new Error('Not a SWF file')
}

/** Builds a zlib-compressed SWF from a body. */
function pack (version, body) {
  const head = Buffer.alloc(8)
  head.write('CWS', 0, 'latin1')
  head[3] = version
  head.writeUInt32LE(body.length + 8, 4)
  return Buffer.concat([head, zlib.deflateSync(body)])
}

/** Walks the SWF tags. Yields { code, start, dataStart, length }. */
function * tags (body) {
  // Skip the frame RECT (5-bit field count), frame rate and frame count.
  const nbits = body[0] >> 3
  let pos = Math.ceil((5 + nbits * 4) / 8) + 4
  while (pos < body.length) {
    const start = pos
    const head = body.readUInt16LE(pos); pos += 2
    const code = head >> 6
    let length = head & 0x3F
    if (length === 0x3F) { length = body.readUInt32LE(pos); pos += 4 }
    yield { code, start, dataStart: pos, length }
    pos += length
    if (code === 0) break
  }
}

/* ------------------------------------------------------------- ABC reader */

class Reader {
  constructor (buf, pos) { this.buf = buf; this.pos = pos }
  u8 () { return this.buf[this.pos++] }
  u16 () { const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v }
  u30 () {
    let result = 0
    for (let i = 0; i < 5; i++) {
      const b = this.buf[this.pos++]
      result += (b & 0x7F) * 2 ** (7 * i)
      if (!(b & 0x80)) break
    }
    return result
  }

  skip (n) { this.pos += n }
}

/**
 * Finds every method body in an ABC block, with class and method names.
 * Returns { methods: [{ className, name, kind, method }], bodies: Map(method -> {codeStart, codeLength, maxStackPos}) }
 */
function readAbc (buf, start) {
  const r = new Reader(buf, start)
  r.u16(); r.u16() // minor, major

  // Constant pool
  let n = r.u30(); for (let i = 1; i < n; i++) r.u30() // ints
  n = r.u30(); for (let i = 1; i < n; i++) r.u30() // uints
  n = r.u30(); r.skip(Math.max(0, n - 1) * 8) // doubles
  n = r.u30()
  const strings = ['']
  for (let i = 1; i < n; i++) {
    const len = r.u30()
    strings.push(buf.toString('utf8', r.pos, r.pos + len))
    r.skip(len)
  }
  n = r.u30(); for (let i = 1; i < n; i++) { r.u8(); r.u30() } // namespaces
  n = r.u30(); for (let i = 1; i < n; i++) { const c = r.u30(); for (let j = 0; j < c; j++) r.u30() } // ns sets
  n = r.u30()
  const multinames = [null]
  for (let i = 1; i < n; i++) {
    const kind = r.u8()
    switch (kind) {
      case 0x07: case 0x0D: { r.u30(); multinames.push(strings[r.u30()]); break }
      case 0x0F: case 0x10: { multinames.push(strings[r.u30()]); break }
      case 0x11: case 0x12: { multinames.push(null); break }
      case 0x09: case 0x0E: { const name = r.u30(); r.u30(); multinames.push(strings[name]); break }
      case 0x1B: case 0x1C: { r.u30(); multinames.push(null); break }
      case 0x1D: { r.u30(); const c = r.u30(); for (let j = 0; j < c; j++) r.u30(); multinames.push(null); break }
      default: throw new Error(`Unknown multiname kind ${kind}`)
    }
  }

  // Methods
  const methodCount = r.u30()
  for (let i = 0; i < methodCount; i++) {
    const params = r.u30()
    r.u30() // return type
    for (let j = 0; j < params; j++) r.u30()
    r.u30() // name
    const flags = r.u8()
    if (flags & 0x08) { const c = r.u30(); for (let j = 0; j < c; j++) { r.u30(); r.u8() } }
    if (flags & 0x80) for (let j = 0; j < params; j++) r.u30()
  }

  // Metadata
  n = r.u30()
  for (let i = 0; i < n; i++) { r.u30(); const c = r.u30(); for (let j = 0; j < c * 2; j++) r.u30() }

  const methods = []
  const readTraits = (className) => {
    const count = r.u30()
    for (let i = 0; i < count; i++) {
      const name = multinames[r.u30()]
      const kindByte = r.u8()
      const kind = kindByte & 0x0F
      if (kind === 0 || kind === 6) {
        r.u30(); r.u30()
        if (r.u30()) r.u8()
      } else if (kind === 4 || kind === 5) {
        r.u30(); r.u30()
      } else if (kind >= 1 && kind <= 3) {
        r.u30()
        methods.push({ className, name, kind, method: r.u30() })
      } else {
        throw new Error(`Unknown trait kind ${kind}`)
      }
      if ((kindByte >> 4) & 0x04) { const c = r.u30(); for (let j = 0; j < c; j++) r.u30() }
    }
  }

  const classCount = r.u30()
  const classNames = []
  for (let i = 0; i < classCount; i++) {
    const name = multinames[r.u30()]
    classNames.push(name)
    r.u30() // super
    const flags = r.u8()
    if (flags & 0x08) r.u30()
    const c = r.u30(); for (let j = 0; j < c; j++) r.u30()
    r.u30() // iinit
    readTraits(name)
  }
  for (let i = 0; i < classCount; i++) { r.u30(); readTraits(classNames[i]) }
  n = r.u30()
  for (let i = 0; i < n; i++) { r.u30(); readTraits(null) }

  const bodies = new Map()
  n = r.u30()
  for (let i = 0; i < n; i++) {
    const method = r.u30()
    const maxStackPos = r.pos
    r.u30(); r.u30(); r.u30(); r.u30() // max stack, locals, init scope, max scope
    const codeLength = r.u30()
    const codeStart = r.pos
    r.skip(codeLength)
    const ex = r.u30(); for (let j = 0; j < ex; j++) { r.u30(); r.u30(); r.u30(); r.u30(); r.u30() }
    readTraits(null)
    bodies.set(method, { codeStart, codeLength, maxStackPos })
  }
  return { methods, bodies }
}

const OP = { nop: 0x02, pushfalse: 0x27, pushtrue: 0x26, returnvalue: 0x48 }

/**
 * Makes SmartFoxClient.useSecureMode() return false.
 * @param {Buffer} swf the official game file
 * @returns {{swf: Buffer, changed: boolean, before: string}}
 *   changed is false when the method already returned false
 */
function disableSecureMode (swf) {
  const { version, body } = unpack(swf)
  const out = Buffer.from(body)
  let found = null

  for (const tag of tags(out)) {
    if (tag.code !== 82 && tag.code !== 72) continue
    let abcStart = tag.dataStart
    if (tag.code === 82) {
      abcStart += 4 // flags
      while (out[abcStart] !== 0) abcStart++ // name
      abcStart++
    }
    const { methods, bodies } = readAbc(out, abcStart)
    const m = methods.find(x => x.className === 'SmartFoxClient' && x.name === 'useSecureMode' && x.kind === 1)
    if (m) { found = bodies.get(m.method); break }
  }
  if (!found) throw new Error("Couldn't find the game's secure-connection setting. The game may have changed.")

  const { codeStart, codeLength } = found
  const before = out.subarray(codeStart, codeStart + codeLength).toString('hex')
  if (codeLength < 2) throw new Error('Unexpected game code (method too short)')

  // Pad with no-ops, then "return false". Same length, so nothing else moves.
  const code = Buffer.alloc(codeLength, OP.nop)
  code[codeLength - 2] = OP.pushfalse
  code[codeLength - 1] = OP.returnvalue
  const already = before.endsWith('2748') // already ends in pushfalse, returnvalue
  code.copy(out, codeStart)

  return { swf: pack(version, out), changed: !already, before }
}

module.exports = { unpack, pack, tags, readAbc, disableSecureMode }
