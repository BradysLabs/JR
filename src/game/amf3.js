'use strict'

/**
 * AMF3 reader (Flash's binary object format), enough for the game's item
 * definition packs. Objects come back as plain JS objects, arrays as arrays
 * (or objects when they have named keys), byte arrays as Buffers.
 */
class Amf3Reader {
  constructor (buf) {
    this.buf = buf
    this.pos = 0
    this.strings = []
    this.objects = []
    this.traits = []
  }

  u8 () { return this.buf[this.pos++] }

  u29 () {
    let v = 0
    for (let i = 0; i < 4; i++) {
      const b = this.u8()
      if (i === 3) return ((v << 8) | b) >>> 0
      v = (v << 7) | (b & 0x7F)
      if (!(b & 0x80)) return v >>> 0
    }
    return v >>> 0
  }

  int () {
    const v = this.u29()
    return v & 0x10000000 ? v - 0x20000000 : v
  }

  string () {
    const ref = this.u29()
    if (!(ref & 1)) return this.strings[ref >> 1]
    const len = ref >> 1
    if (len === 0) return ''
    const s = this.buf.toString('utf8', this.pos, this.pos + len)
    this.pos += len
    this.strings.push(s)
    return s
  }

  read () {
    const type = this.u8()
    switch (type) {
      case 0x00: return undefined
      case 0x01: return null
      case 0x02: return false
      case 0x03: return true
      case 0x04: return this.int()
      case 0x05: { const v = this.buf.readDoubleBE(this.pos); this.pos += 8; return v }
      case 0x06: return this.string()
      case 0x07: case 0x0B: return this.xml()
      case 0x08: return this.date()
      case 0x09: return this.array()
      case 0x0A: return this.object()
      case 0x0C: return this.bytes()
      case 0x0D: case 0x0E: case 0x0F: case 0x10: return this.vector(type)
      case 0x11: return this.dictionary()
      default: throw new Error(`Unknown AMF3 type 0x${type.toString(16)} at ${this.pos - 1}`)
    }
  }

  ref () {
    const v = this.u29()
    return { inline: !!(v & 1), value: v >> 1 }
  }

  xml () {
    const r = this.ref()
    if (!r.inline) return this.objects[r.value]
    const s = this.buf.toString('utf8', this.pos, this.pos + r.value)
    this.pos += r.value
    this.objects.push(s)
    return s
  }

  date () {
    const r = this.ref()
    if (!r.inline) return this.objects[r.value]
    const d = new Date(this.buf.readDoubleBE(this.pos)); this.pos += 8
    this.objects.push(d)
    return d
  }

  array () {
    const r = this.ref()
    if (!r.inline) return this.objects[r.value]
    const dense = r.value
    const named = {}
    let hasNamed = false
    const out = []
    this.objects.push(out)
    for (;;) {
      const key = this.string()
      if (key === '') break
      named[key] = this.read()
      hasNamed = true
    }
    for (let i = 0; i < dense; i++) out.push(this.read())
    if (!hasNamed) return out
    const obj = Object.assign({}, out, named)
    this.objects[this.objects.indexOf(out)] = obj
    return obj
  }

  object () {
    const r = this.ref()
    if (!r.inline) return this.objects[r.value]
    let traits
    if (!(r.value & 1)) {
      traits = this.traits[r.value >> 1]
    } else if (r.value & 2) {
      throw new Error('Externalizable AMF3 objects are not supported')
    } else {
      const dynamic = !!(r.value & 4)
      const count = r.value >> 3
      const className = this.string()
      const names = []
      for (let i = 0; i < count; i++) names.push(this.string())
      traits = { className, dynamic, names }
      this.traits.push(traits)
    }
    const obj = {}
    this.objects.push(obj)
    for (const name of traits.names) obj[name] = this.read()
    if (traits.dynamic) {
      for (;;) {
        const key = this.string()
        if (key === '') break
        obj[key] = this.read()
      }
    }
    return obj
  }

  bytes () {
    const r = this.ref()
    if (!r.inline) return this.objects[r.value]
    const b = Buffer.from(this.buf.subarray(this.pos, this.pos + r.value))
    this.pos += r.value
    this.objects.push(b)
    return b
  }

  vector (type) {
    const r = this.ref()
    if (!r.inline) return this.objects[r.value]
    this.u8() // fixed
    const out = []
    this.objects.push(out)
    if (type === 0x10) this.string() // object type name
    for (let i = 0; i < r.value; i++) {
      if (type === 0x0D) { out.push(this.buf.readInt32BE(this.pos)); this.pos += 4 } else if (type === 0x0E) { out.push(this.buf.readUInt32BE(this.pos)); this.pos += 4 } else if (type === 0x0F) { out.push(this.buf.readDoubleBE(this.pos)); this.pos += 8 } else out.push(this.read())
    }
    return out
  }

  dictionary () {
    const r = this.ref()
    if (!r.inline) return this.objects[r.value]
    this.u8() // weak keys
    const out = new Map()
    this.objects.push(out)
    for (let i = 0; i < r.value; i++) out.set(this.read(), this.read())
    return out
  }
}

function readAmf3 (buf) {
  return new Amf3Reader(buf).read()
}

module.exports = { readAmf3, Amf3Reader }
