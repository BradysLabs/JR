'use strict'

/**
 * A small editor for the game's ActionScript bytecode (the ABC block inside
 * ajclient.swf), enough to add a few instructions to an existing method.
 *
 * It reads the block keeping track of where everything sits, then makes
 * edits by splicing bytes: new strings go at the end of the string table
 * (so every existing index stays the same), and new code goes into one
 * method body with every jump in that method corrected. Nothing else moves
 * relative to anything that refers to it, because ABC refers to things by
 * index, not by position.
 */

class Reader {
  constructor (buf, pos) { this.buf = buf; this.pos = pos }
  u8 () { return this.buf[this.pos++] }
  u16 () { const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v }
  s24 () { const v = this.buf.readIntLE(this.pos, 3); this.pos += 3; return v }
  u30 () {
    let result = 0
    for (let i = 0; i < 5; i++) {
      const b = this.buf[this.pos++]
      result += (b & 0x7F) * 2 ** (7 * i)
      if (!(b & 0x80)) break
    }
    return result
  }
}

function u30Bytes (n) {
  const out = []
  do { let b = n & 0x7F; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b) } while (n)
  return out
}

function s24Bytes (n) {
  const b = Buffer.alloc(3)
  b.writeIntLE(n, 0, 3)
  return [...b]
}

/** Reads an ABC block starting at `start` in `buf`, with positions. */
function parse (buf, start) {
  const r = new Reader(buf, start)
  const A = { start }
  r.u16(); r.u16() // minor, major
  let n = r.u30(); for (let i = 1; i < n; i++) r.u30() // ints
  n = r.u30(); for (let i = 1; i < n; i++) r.u30() // uints
  n = r.u30(); r.pos += Math.max(0, n - 1) * 8 // doubles
  A.stringCountAt = r.pos
  n = r.u30()
  A.strings = ['']
  for (let i = 1; i < n; i++) {
    const len = r.u30()
    A.strings.push(buf.toString('utf8', r.pos, r.pos + len))
    r.pos += len
  }
  A.stringsEnd = r.pos
  n = r.u30()
  A.namespaces = [null]
  for (let i = 1; i < n; i++) { const kind = r.u8(); A.namespaces.push({ kind, name: A.strings[r.u30()] }) }
  n = r.u30(); for (let i = 1; i < n; i++) { const c = r.u30(); for (let j = 0; j < c; j++) r.u30() } // ns sets
  n = r.u30()
  A.multinames = [null]
  for (let i = 1; i < n; i++) {
    const kind = r.u8()
    const m = { kind, ns: null, name: null }
    if (kind === 0x07 || kind === 0x0D) { m.ns = r.u30(); m.name = A.strings[r.u30()] } else if (kind === 0x0F || kind === 0x10) { m.name = A.strings[r.u30()] } else if (kind === 0x11 || kind === 0x12) {
      // runtime name and namespace
    } else if (kind === 0x09 || kind === 0x0E) { m.name = A.strings[r.u30()]; r.u30() } else if (kind === 0x1B || kind === 0x1C) { r.u30() } else if (kind === 0x1D) { r.u30(); const c = r.u30(); for (let j = 0; j < c; j++) r.u30() } else throw new Error(`Unknown multiname kind ${kind}`)
    A.multinames.push(m)
  }
  n = r.u30()
  for (let i = 0; i < n; i++) {
    const params = r.u30(); r.u30(); for (let j = 0; j < params; j++) r.u30()
    r.u30()
    const flags = r.u8()
    if (flags & 0x08) { const c = r.u30(); for (let j = 0; j < c; j++) { r.u30(); r.u8() } }
    if (flags & 0x80) for (let j = 0; j < params; j++) r.u30()
  }
  n = r.u30(); for (let i = 0; i < n; i++) { r.u30(); const c = r.u30(); for (let j = 0; j < c * 2; j++) r.u30() } // metadata
  const traits = () => {
    const out = []
    const c = r.u30()
    for (let i = 0; i < c; i++) {
      const name = r.u30()
      const kindByte = r.u8()
      const kind = kindByte & 0x0F
      const t = { name, kind, method: null }
      if (kind === 0 || kind === 6) { r.u30(); r.u30(); if (r.u30()) r.u8() } else if (kind === 4 || kind === 5) { r.u30(); r.u30() } else if (kind >= 1 && kind <= 3) { r.u30(); t.method = r.u30() } else throw new Error(`Unknown trait kind ${kind}`)
      if (kindByte & 0x40) { const m = r.u30(); for (let j = 0; j < m; j++) r.u30() }
      out.push(t)
    }
    return out
  }
  const count = r.u30()
  A.instances = []
  for (let i = 0; i < count; i++) {
    const name = r.u30(); r.u30()
    const flags = r.u8()
    if (flags & 0x08) r.u30()
    const c = r.u30(); for (let j = 0; j < c; j++) r.u30()
    const iinit = r.u30()
    A.instances.push({ name, iinit, traits: traits() })
  }
  for (let i = 0; i < count; i++) { r.u30(); A.instances[i].staticTraits = traits() }
  n = r.u30(); for (let i = 0; i < n; i++) { r.u30(); traits() } // scripts
  A.bodies = new Map()
  n = r.u30()
  for (let i = 0; i < n; i++) {
    const method = r.u30()
    const at = r.pos
    const maxStack = r.u30(); const locals = r.u30(); const initScope = r.u30(); const maxScope = r.u30()
    const codeLength = r.u30()
    const codeStart = r.pos
    r.pos += codeLength
    const exceptions = r.u30()
    const handlers = []
    for (let j = 0; j < exceptions; j++) handlers.push({ from: r.u30(), to: r.u30(), target: r.u30(), type: r.u30(), name: r.u30() })
    const exceptionsEnd = r.pos
    traits()
    A.bodies.set(method, { at, maxStack, locals, initScope, maxScope, codeStart, codeLength, exceptions, handlers, exceptionsEnd })
  }
  A.end = r.pos
  return A
}

const nameOf = (A, index) => (A.multinames[index] && A.multinames[index].name) || null

/** The body of an instance method (or getter/setter), by class and method name. */
function findMethod (A, className, methodName) {
  for (const inst of A.instances) {
    if (nameOf(A, inst.name) !== className) continue
    const trait = inst.traits.find(t => t.method !== null && nameOf(A, t.name) === methodName)
    if (trait) return A.bodies.get(trait.method) || null
  }
  return null
}

/** A public name (or one in a named package), e.g. ('flash.external', 'ExternalInterface'). */
function publicName (A, pkg, name) {
  for (let i = 1; i < A.multinames.length; i++) {
    const m = A.multinames[i]
    if (m.kind !== 0x07 || m.name !== name) continue
    const ns = A.namespaces[m.ns]
    if (ns && ns.kind === 0x16 && ns.name === pkg) return i
  }
  return null
}

/* Operand formats: b = branch (s24), m = multiname, ma = multiname + arg
   count, u = u30, uu = two u30s, b8 = one byte, ls = lookupswitch, dbg = debug. */
const FORMATS = (() => {
  const f = {}
  const set = (codes, kind) => codes.forEach(c => { f[c] = kind })
  set([0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1A], 'b')
  set([0x04, 0x05, 0x59, 0x5D, 0x5E, 0x5F, 0x60, 0x61, 0x66, 0x68, 0x6A, 0x80, 0x86, 0xB2], 'u')
  set([0x45, 0x46, 0x4A, 0x4C, 0x4E, 0x4F, 0x32, 0x43, 0x44], 'uu')
  set([0x06, 0x08, 0x25, 0x2C, 0x2D, 0x2E, 0x2F, 0x31, 0x40, 0x41, 0x42, 0x49, 0x53, 0x55, 0x56, 0x58, 0x5A, 0x62, 0x63, 0x6C, 0x6D, 0x6E, 0x6F, 0x92, 0x94, 0xC2, 0xC3, 0xF0, 0xF1, 0xF2], 'u')
  set([0x24, 0x65], 'b8')
  f[0x1B] = 'ls'
  f[0xEF] = 'dbg'
  set([0x01, 0x02, 0x03, 0x07, 0x09, 0x1C, 0x1D, 0x1E, 0x1F, 0x20, 0x21, 0x23, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x2B, 0x30,
    0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x3B, 0x3C, 0x3D, 0x3E, 0x47, 0x48, 0x50, 0x51, 0x52, 0x57, 0x64,
    0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x81, 0x82, 0x83, 0x84, 0x85, 0x87, 0x88, 0x89,
    0x90, 0x91, 0x93, 0x95, 0x96, 0x97, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF, 0xB0, 0xB1, 0xB3, 0xB4,
    0xC0, 0xC1, 0xC4, 0xC5, 0xC6, 0xC7, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xF3], '')
  return f
})()

/**
 * Splits code into instructions: [{ at, op, length, operands, branches }].
 * branches: [{ field, base, target }] where field is the position of the
 * s24 offset, and target = base + offset.
 */
function decode (code) {
  const r = new Reader(code, 0)
  const out = []
  while (r.pos < code.length) {
    const at = r.pos
    const op = r.u8()
    const format = FORMATS[op]
    if (format === undefined) throw new Error(`Unknown instruction 0x${op.toString(16)} at ${at}`)
    const operands = []
    const branches = []
    if (format === 'b') {
      const field = r.pos
      const offset = r.s24()
      branches.push({ field, base: r.pos, target: r.pos + offset })
    } else if (format === 'u') operands.push(r.u30())
    else if (format === 'uu') operands.push(r.u30(), r.u30())
    else if (format === 'b8') operands.push(r.u8())
    else if (format === 'dbg') { r.u8(); r.u30(); r.u8(); r.u30() } else if (format === 'ls') {
      const field = r.pos
      branches.push({ field, base: at, target: at + r.s24() })
      const cases = r.u30()
      for (let i = 0; i <= cases; i++) { const f = r.pos; branches.push({ field: f, base: at, target: at + r.s24() }) }
    }
    out.push({ at, op, length: r.pos - at, operands, branches })
  }
  if (r.pos !== code.length) throw new Error('Code ends in the middle of an instruction')
  return out
}

/**
 * Inserts `bytes` into `code` at instruction boundary `at` and corrects every
 * jump. A jump to `at` itself goes past the new code (to what was at `at`),
 * so the new code only runs when the code before it falls through.
 */
function insertCode (code, at, bytes, { landOnNew = false } = {}) {
  const list = decode(code)
  if (!list.some(i => i.at === at) && at !== code.length) throw new Error(`${at} is not an instruction boundary`)
  const L = bytes.length
  // landOnNew: a jump to `at` runs the new code too (it was inserted at the
  // start of what that jump goes to).
  const shift = (p) => (landOnNew ? p > at : p >= at) ? p + L : p
  const fixed = Buffer.from(code)
  for (const ins of list) {
    for (const b of ins.branches) {
      const newBase = ins.at >= at ? b.base + L : b.base
      const newTarget = shift(b.target)
      const field = Buffer.from(s24Bytes(newTarget - newBase))
      field.copy(fixed, b.field)
    }
  }
  const out = Buffer.concat([fixed.subarray(0, at), Buffer.from(bytes), fixed.subarray(at)])
  decode(out) // must still be whole instructions
  return out
}

/**
 * Assembles code with labels. Parts are arrays of bytes, { label: 'x' }, or
 * { jump: opcode, to: 'x' } for a branch (opcode + s24 offset).
 */
function assemble (parts) {
  const labels = {}
  let at = 0
  for (const p of parts) {
    if (Array.isArray(p)) at += p.length
    else if (p.label) labels[p.label] = at
    else if (p.jump) at += 4
  }
  const out = []
  for (const p of parts) {
    if (Array.isArray(p)) out.push(...p)
    else if (p.jump) {
      if (!(p.to in labels)) throw new Error(`No label ${p.to}`)
      const end = out.length + 4
      out.push(p.jump, ...s24Bytes(labels[p.to] - end))
    }
  }
  return out
}

/** The operand of the first instruction with this opcode whose name is `name`. */
function operandNamed (A, list, op, name) {
  const ins = list.find(i => i.op === op && nameOf(A, i.operands[0]) === name)
  return ins ? ins.operands[0] : null
}

/** Applies [{start, end, bytes}] edits (non-overlapping) to buf. */
function splice (buf, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start)
  const pieces = []
  let from = 0
  for (const e of sorted) {
    if (e.start < from) throw new Error('Overlapping edits')
    pieces.push(buf.subarray(from, e.start), Buffer.from(e.bytes))
    from = e.end
  }
  pieces.push(buf.subarray(from))
  return Buffer.concat(pieces)
}

/** An edit that adds strings to the end of the string table. Returns { edit, indexes }. */
function addStrings (A, buf, list) {
  const indexes = {}
  const added = []
  let next = A.strings.length
  for (const s of list) {
    const existing = A.strings.indexOf(s)
    if (existing > 0) { indexes[s] = existing; continue }
    indexes[s] = next++
    added.push(s)
  }
  if (!added.length) return { edit: null, indexes }
  const bytes = [...u30Bytes(next)]
  // Old string bytes (everything after the old count), then the new strings.
  const countEnd = (() => { const r = new Reader(buf, A.stringCountAt); r.u30(); return r.pos })()
  const old = buf.subarray(countEnd, A.stringsEnd)
  const tail = []
  for (const s of added) { const b = Buffer.from(s, 'utf8'); tail.push(...u30Bytes(b.length), ...b) }
  return { edit: { start: A.stringCountAt, end: A.stringsEnd, bytes: Buffer.concat([Buffer.from(bytes), old, Buffer.from(tail)]) }, indexes }
}

/** An edit that replaces a method body's code (and raises its max stack if needed). */
function bodyEdit (body, code, maxStack) {
  const head = [
    ...u30Bytes(Math.max(body.maxStack, maxStack)), ...u30Bytes(body.locals), ...u30Bytes(body.initScope),
    ...u30Bytes(body.maxScope), ...u30Bytes(code.length)
  ]
  return { start: body.at, end: body.codeStart + body.codeLength, bytes: Buffer.concat([Buffer.from(head), code]) }
}

/**
 * An edit that inserts `bytes` into a method body at instruction boundary
 * `at`: the code (every jump corrected, see insertCode), its max stack, and
 * its try/catch ranges, moved the same way as jumps.
 */
function bodyInsert (buf, body, at, bytes, { landOnNew = false, maxStack = 0 } = {}) {
  const code = insertCode(buf.subarray(body.codeStart, body.codeStart + body.codeLength), at, bytes, { landOnNew })
  const L = bytes.length
  const shift = (p) => (landOnNew ? p > at : p >= at) ? p + L : p
  const head = [
    ...u30Bytes(Math.max(body.maxStack, maxStack)), ...u30Bytes(body.locals), ...u30Bytes(body.initScope),
    ...u30Bytes(body.maxScope), ...u30Bytes(code.length)
  ]
  const table = [...u30Bytes(body.handlers.length)]
  for (const h of body.handlers) table.push(...u30Bytes(shift(h.from)), ...u30Bytes(shift(h.to)), ...u30Bytes(shift(h.target)), ...u30Bytes(h.type), ...u30Bytes(h.name))
  return { start: body.at, end: body.exceptionsEnd, bytes: Buffer.concat([Buffer.from(head), code, Buffer.from(table)]) }
}

module.exports = { bodyInsert,  parse, decode, insertCode, assemble, operandNamed, splice, addStrings, bodyEdit, findMethod, publicName, nameOf, u30Bytes, s24Bytes }
