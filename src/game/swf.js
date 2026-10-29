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
const abc = require('./abc')

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
  return { methods, bodies, multinames }
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

/** Every ABC block in an unpacked SWF body, read. */
function * abcBlocks (body) {
  for (const tag of tags(body)) {
    if (tag.code !== 82 && tag.code !== 72) continue
    let abcStart = tag.dataStart
    if (tag.code === 82) {
      abcStart += 4
      while (body[abcStart] !== 0) abcStart++
      abcStart++
    }
    yield readAbc(body, abcStart)
  }
}

const u30Bytes = (n) => {
  const out = []
  do { let b = n & 0x7F; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b) } while (n)
  return out
}

/**
 * Makes the game ask the server for your own My Shop every time you open it,
 * instead of showing the copy it saved earlier. Without this, items JR puts
 * in your shop don't show until you log in again.
 *
 * ShopToSell.requestShopList starts with
 *   if (_isDenSaleShopOwner && ShopManager.myShopItems[id] != null) use the saved copy
 * JR swaps the "getlex _isDenSaleShopOwner" for "pushfalse" (same length).
 * @returns {'patched'|'already'|'missing'}
 */
function patchShopRefresh (body) {
  for (const { methods, bodies, multinames } of abcBlocks(body)) {
    const m = methods.find(x => x.className === 'ShopToSell' && x.name === 'requestShopList' && x.kind === 1)
    if (!m) continue
    const b = bodies.get(m.method)
    const code = body.subarray(b.codeStart, b.codeStart + b.codeLength)
    const nameIndexes = multinames.map((x, i) => (x === '_isDenSaleShopOwner' ? i : -1)).filter(i => i > 0)
    for (const index of nameIndexes) {
      const op = Buffer.from([0x60, ...u30Bytes(index)]) // getlex _isDenSaleShopOwner
      const at = code.indexOf(op)
      if (at === -1) continue
      code[at] = OP.pushfalse
      code.fill(OP.nop, at + 1, at + op.length)
      return 'patched'
    }
    // Already patched: starts with getlocal0, pushscope, pushfalse.
    if (code[2] === OP.pushfalse) return 'already'
  }
  return 'missing'
}

/**
 * Turns off the game's own idle logout. The game counts down from the last
 * message it sent itself (7 minutes), shows a warning, then disconnects; it
 * doesn't see the keep-alive messages JR sends. JR replaces
 * KeepAlive.timeLeftTimer with "return", and sends the keep-alives instead.
 * @returns {'patched'|'already'|'missing'}
 */
function patchIdleKick (body) {
  for (const { methods, bodies } of abcBlocks(body)) {
    const m = methods.find(x => x.className === 'KeepAlive' && x.name === 'timeLeftTimer' && x.kind === 1)
    if (!m) continue
    const b = bodies.get(m.method)
    const code = body.subarray(b.codeStart, b.codeStart + b.codeLength)
    if (code[code.length - 1] === 0x47 && code.subarray(0, code.length - 1).every(x => x === OP.nop)) return 'already'
    code.fill(OP.nop)
    code[code.length - 1] = 0x47 // returnvoid
    return 'patched'
  }
  return 'missing'
}

/**
 * Item hover: when the game shows an item's tooltip, it also tells the page
 * which item is under the mouse, so JR can show its worth bubble:
 *
 *   ExternalInterface.call("jrItemOver", item.defId, item.color, item.name,
 *     stage.mouseX, stage.mouseY, stage.stageWidth, stage.stageHeight)
 *
 * is added to ItemWindowBase.onWindowRollOver, right after the game starts
 * its own tooltip, and ExternalInterface.call("jrItemOut") to
 * onWindowRollOut, right after it hides it. Both only run when
 * ExternalInterface is available. Everything is checked first; if anything
 * isn't as expected the game file is left alone.
 * @returns {{body: Buffer, status: 'patched'|'missing'}}
 */
function patchItemHover (body) {
  for (const tag of tags(body)) {
    if (tag.code !== 82 && tag.code !== 72) continue
    let abcStart = tag.dataStart
    if (tag.code === 82) {
      abcStart += 4
      while (body[abcStart] !== 0) abcStart++
      abcStart++
    }
    const A = abc.parse(body, abcStart)
    const over = abc.findMethod(A, 'ItemWindowBase', 'onWindowRollOver')
    const out = abc.findMethod(A, 'ItemWindowBase', 'onWindowRollOut')
    if (!over || !out || over.exceptions || out.exceptions) continue

    const names = {
      ExternalInterface: abc.publicName(A, 'flash.external', 'ExternalInterface'),
      available: abc.publicName(A, '', 'available'),
      call: abc.publicName(A, '', 'call'),
      defId: abc.publicName(A, '', 'defId'),
      color: abc.publicName(A, '', 'color'),
      name: abc.publicName(A, '', 'name'),
      stage: abc.publicName(A, '', 'stage'),
      mouseX: abc.publicName(A, '', 'mouseX'),
      mouseY: abc.publicName(A, '', 'mouseY'),
      stageWidth: abc.publicName(A, '', 'stageWidth'),
      stageHeight: abc.publicName(A, '', 'stageHeight')
    }
    if (Object.values(names).some(v => !v)) return { body, status: 'missing' }

    const overCode = body.subarray(over.codeStart, over.codeStart + over.codeLength)
    const outCode = body.subarray(out.codeStart, out.codeStart + out.codeLength)
    const overList = abc.decode(overCode)
    const outList = abc.decode(outCode)
    // The method's own reference to the hovered item (a private field).
    const currItemLex = overList.find(i => i.op === 0x60 && abc.nameOf(A, i.operands[0]) === '_currItem')
    const startTimer = overList.find(i => i.op === 0x4F && abc.nameOf(A, i.operands[0]) === 'startTimer')
    const hide = outList.find(i => i.op === 0x4F && abc.nameOf(A, i.operands[0]) === 'resetTimerAndSetVisibility')
    if (!currItemLex || !startTimer || !hide) return { body, status: 'missing' }
    const overAt = startTimer.at + startTimer.length
    const outAt = hide.at + hide.length
    if (overCode[overAt] !== 0x47 || outCode[outAt] !== 0x47) return { body, status: 'missing' } // returnvoid

    const strings = abc.addStrings(A, body, ['jrItemOver', 'jrItemOut'])
    const u = abc.u30Bytes
    const op = (code, ...args) => [code, ...args.flatMap(a => u(a))]
    const guarded = (inner) => {
      // if (ExternalInterface.available) { inner }
      const head = [...op(0x60, names.ExternalInterface), ...op(0x66, names.available)]
      return [...head, 0x12, ...abc.s24Bytes(inner.length), ...inner] // iffalse past inner
    }
    const currItem = currItemLex.operands[0]
    const overBytes = guarded([
      ...op(0x60, names.ExternalInterface),
      ...op(0x2C, strings.indexes.jrItemOver),
      ...op(0x60, currItem), ...op(0x66, names.defId),
      ...op(0x60, currItem), ...op(0x66, names.color),
      ...op(0x60, currItem), ...op(0x66, names.name),
      0xD0, ...op(0x66, names.stage), ...op(0x66, names.mouseX),
      0xD0, ...op(0x66, names.stage), ...op(0x66, names.mouseY),
      0xD0, ...op(0x66, names.stage), ...op(0x66, names.stageWidth),
      0xD0, ...op(0x66, names.stage), ...op(0x66, names.stageHeight),
      ...op(0x4F, names.call, 8)
    ])
    const outBytes = guarded([
      ...op(0x60, names.ExternalInterface),
      ...op(0x2C, strings.indexes.jrItemOut),
      ...op(0x4F, names.call, 1)
    ])

    const edits = [
      abc.bodyEdit(over, abc.insertCode(overCode, overAt, overBytes), 9),
      abc.bodyEdit(out, abc.insertCode(outCode, outAt, outBytes), 2)
    ]
    if (strings.edit) edits.push(strings.edit)
    let result = abc.splice(body, edits)
    // The tag's length changed by the same amount the block did.
    const delta = result.length - body.length
    if (tag.code === 82 || tag.code === 72) {
      if ((body.readUInt16LE(tag.start) & 0x3F) !== 0x3F) return { body, status: 'missing' }
      result = Buffer.from(result)
      result.writeUInt32LE(tag.length + delta, tag.start + 2)
    }
    return { body: result, status: 'patched' }
  }
  return { body, status: 'missing' }
}

/** The ABC block of an unpacked SWF body: { tag, abcStart } or null. */
function abcTag (body) {
  for (const tag of tags(body)) {
    if (tag.code !== 82 && tag.code !== 72) continue
    let abcStart = tag.dataStart
    if (tag.code === 82) {
      abcStart += 4
      while (body[abcStart] !== 0) abcStart++
      abcStart++
    }
    return { tag, abcStart }
  }
  return null
}

/** Applies edits to the ABC block and fixes its tag's length. */
function applyAbcEdits (body, tag, edits) {
  if ((body.readUInt16LE(tag.start) & 0x3F) !== 0x3F) throw new Error('Unexpected short ABC tag')
  const result = Buffer.from(abc.splice(body, edits))
  result.writeUInt32LE(tag.length + (result.length - body.length), tag.start + 2)
  return result
}

/**
 * JR's rows in Animal Jam's own Settings window.
 *
 * AJ builds that window from a list of row records ({type, frame, labelTxt,
 * onTxt, offTxt}) shown by ItemWindowToggle. Three additions:
 *
 *   MySettings.setupContent   before the list is shown, adds the rows the
 *                             page gives for ExternalInterface.call("jrSettingsRows")
 *   ItemWindowToggle.setChildrenAndInitialConditions
 *                             a JR row (one with a `key`) gets its own label,
 *                             On/Off words and state, and none of AJ's setup
 *   ItemWindowToggle.handleMouseDown
 *                             clicking a JR row flips its switch and calls
 *                             ExternalInterface.call("jrSettingToggle", key, value);
 *                             AJ's own account settings are never touched
 *
 * Everything is checked first; if anything isn't as expected the file is
 * left alone.
 * @returns {{body: Buffer, status: 'patched'|'missing'}}
 */
function patchJrSettings (body) {
  const found = abcTag(body)
  if (!found) return { body, status: 'missing' }
  const { tag, abcStart } = found
  const A = abc.parse(body, abcStart)
  const setup = abc.findMethod(A, 'MySettings', 'setupContent')
  const draw = abc.findMethod(A, 'ItemWindowToggle', 'setChildrenAndInitialConditions')
  const click = abc.findMethod(A, 'ItemWindowToggle', 'handleMouseDown')
  if (!setup || !draw || !click) return { body, status: 'missing' }
  const codeOf = (m) => body.subarray(m.codeStart, m.codeStart + m.codeLength)
  const setupList = abc.decode(codeOf(setup))
  const drawList = abc.decode(codeOf(draw))
  const clickList = abc.decode(codeOf(click))
  const str = (s) => { const i = A.strings.indexOf(s); return i > 0 ? i : null }

  const n = {
    EI: abc.publicName(A, 'flash.external', 'ExternalInterface'),
    available: abc.publicName(A, '', 'available'),
    call: abc.publicName(A, '', 'call'),
    concat: abc.publicName(A, '', 'concat'),
    key: abc.publicName(A, '', 'key'),
    value: abc.publicName(A, '', 'value'),
    // the names exactly as AJ's own code in these methods spells them
    arrayType: abc.operandNamed(A, setupList, 0x80, 'Array'),
    windowGenerator: abc.operandNamed(A, setupList, 0x5D, 'WindowGenerator'),
    currItem: abc.operandNamed(A, drawList, 0x60, '_currItem'),
    window: abc.operandNamed(A, drawList, 0x60, '_window'),
    labelTxtCont: abc.operandNamed(A, drawList, 0x66, 'labelTxtCont'),
    labelTxt: abc.operandNamed(A, drawList, 0x66, 'labelTxt'),
    toggleBtn: abc.operandNamed(A, drawList, 0x66, 'toggleBtn'),
    valueTxt: abc.operandNamed(A, drawList, 0x66, 'valueTxt'),
    onTxt: abc.operandNamed(A, drawList, 0x66, 'onTxt'),
    offTxt: abc.operandNamed(A, drawList, 0x66, 'offTxt'),
    text: abc.operandNamed(A, drawList, 0x61, 'text'),
    gotoAndStop: abc.operandNamed(A, drawList, 0x4F, 'gotoAndStop'),
    clickCurrItem: abc.operandNamed(A, clickList, 0x60, '_currItem'),
    currentTarget: abc.operandNamed(A, clickList, 0x66, 'currentTarget'),
    clickToggleBtn: abc.operandNamed(A, clickList, 0x66, 'toggleBtn'),
    gotoAndPlay: abc.operandNamed(A, clickList, 0x4F, 'gotoAndPlay'),
    startingOn: str('startingOn'),
    startingOff: str('startingOff'),
    on: str('on'),
    off: str('off')
  }
  if (Object.values(n).some(v => !v)) return { body, status: 'missing' }

  // Where each addition goes.
  const listAt = setupList.find(i => i.op === 0x5D && i.operands[0] === n.windowGenerator)
  const listReady = setupList.some(i => i.op === 0x63 && i.operands[0] === 4 && listAt && i.at < listAt.at) // setlocal 4 = the row list
  // AJ's second look at the row, by its frame: "getlex _currItem; getproperty frame; setlocal2".
  const drawAt = drawList.find((i, k) => i.op === 0x60 && i.operands[0] === n.currItem && drawList[k + 1] && drawList[k + 1].op === 0x66 &&
    abc.nameOf(A, drawList[k + 1].operands[0]) === 'frame' && drawList[k + 2] && drawList[k + 2].op === 0xD6)
  const stop = clickList.find(i => i.op === 0x4F && abc.nameOf(A, i.operands[0]) === 'stopPropagation')
  if (!listAt || !listReady || !drawAt || !stop || clickList[0].at !== 0) return { body, status: 'missing' }

  const strings = abc.addStrings(A, body, ['jrSettingsRows', 'jrSettingToggle'])
  const u = abc.u30Bytes
  const op = (code, ...args) => [code, ...args.flatMap(a => u(a))]
  const IFFALSE = 0x12
  const JUMP = 0x10

  // rows = rows.concat(ExternalInterface.call("jrSettingsRows")) when it gives an array
  const listCode = abc.assemble([
    op(0x60, n.EI), op(0x66, n.available), { jump: IFFALSE, to: 'end' },
    op(0x60, n.EI), op(0x2C, strings.indexes.jrSettingsRows), op(0x46, n.call, 1),
    [0x2A], { jump: IFFALSE, to: 'drop' }, // dup; nothing given
    op(0x62, 4), [0x2B], op(0x46, n.concat, 1), op(0x80, n.arrayType), op(0x63, 4), // getlocal 4; swap; concat; coerce Array; setlocal 4
    { jump: JUMP, to: 'end' },
    { label: 'drop' }, [0x29], // pop
    { label: 'end' }
  ])

  // A JR row: its own words and state, then nothing else.
  const toggle = [...op(0x60, n.window), ...op(0x66, n.toggleBtn), ...op(0x66, n.toggleBtn)]
  const drawCode = abc.assemble([
    op(0x60, n.currItem), op(0x66, n.key), { jump: IFFALSE, to: 'end' },
    op(0x60, n.window), op(0x66, n.labelTxtCont), op(0x66, n.labelTxt), op(0x60, n.currItem), op(0x66, n.labelTxt), op(0x61, n.text),
    toggle, op(0x66, n.valueTxt), op(0x66, n.onTxt), op(0x60, n.currItem), op(0x66, n.onTxt), op(0x61, n.text),
    toggle, op(0x66, n.valueTxt), op(0x66, n.offTxt), op(0x60, n.currItem), op(0x66, n.offTxt), op(0x61, n.text),
    toggle, op(0x60, n.currItem), op(0x66, n.value), { jump: IFFALSE, to: 'off' },
    op(0x2C, n.startingOn), { jump: JUMP, to: 'set' },
    { label: 'off' }, op(0x2C, n.startingOff),
    { label: 'set' }, op(0x4F, n.gotoAndStop, 1),
    [0x47], // returnvoid
    { label: 'end' }
  ])

  // Clicking a JR row: flip it, animate it, tell JR.
  const item = op(0x60, n.clickCurrItem)
  const clickCode = abc.assemble([
    item, op(0x66, n.key), { jump: IFFALSE, to: 'end' },
    item, item, op(0x66, n.value), [0x96], op(0x61, n.value), // value = !value
    [0xD1], op(0x66, n.currentTarget), op(0x66, n.clickToggleBtn), item, op(0x66, n.value), { jump: IFFALSE, to: 'off' },
    op(0x2C, n.on), { jump: JUMP, to: 'play' },
    { label: 'off' }, op(0x2C, n.off),
    { label: 'play' }, op(0x4F, n.gotoAndPlay, 1),
    op(0x60, n.EI), op(0x66, n.available), { jump: IFFALSE, to: 'done' },
    op(0x60, n.EI), op(0x2C, strings.indexes.jrSettingToggle), item, op(0x66, n.key), item, op(0x66, n.value), op(0x4F, n.call, 3),
    { label: 'done' }, [0x47],
    { label: 'end' }
  ])

  const edits = [
    abc.bodyInsert(body, setup, listAt.at, listCode, { landOnNew: true, maxStack: 4 }),
    abc.bodyInsert(body, draw, drawAt.at, drawCode, { landOnNew: true, maxStack: 6 }),
    abc.bodyInsert(body, click, stop.at + stop.length, clickCode, { landOnNew: true, maxStack: 6 })
  ]
  if (strings.edit) edits.push(strings.edit)
  return { body: applyAbcEdits(body, tag, edits), status: 'patched' }
}

/**
 * All of JR's changes to the game file.
 * @param {{antiIdle?: boolean, itemHover?: boolean}} [options]
 *   antiIdle: turn off the game's idle logout; itemHover: tell JR which item
 *   is under the mouse (for the worth bubble)
 *   jrSettings: JR's rows in AJ's own Settings window
 * @returns {{swf: Buffer, shopRefresh: string, idleKick: string, itemHover: string, jrSettings: string}}
 */
function patchClient (swf, { antiIdle = false, itemHover = false, jrSettings = false } = {}) {
  const secure = disableSecureMode(swf) // throws if the game changed too much
  const { version, body } = unpack(secure.swf)
  let out = Buffer.from(body)
  const shopRefresh = patchShopRefresh(out)
  const idleKick = antiIdle ? patchIdleKick(out) : 'off'
  let hover = 'off'
  if (itemHover) {
    // Last: it changes lengths, the other patches don't.
    try {
      const result = patchItemHover(out)
      out = result.body
      hover = result.status
    } catch (_) {
      hover = 'missing'
    }
  }
  let settingsRows = 'off'
  if (jrSettings) {
    try {
      const result = patchJrSettings(out)
      out = result.body
      settingsRows = result.status
    } catch (_) {
      settingsRows = 'missing'
    }
  }
  return { swf: pack(version, out), shopRefresh, idleKick, itemHover: hover, jrSettings: settingsRows }
}

module.exports = { unpack, pack, tags, readAbc, disableSecureMode, patchShopRefresh, patchIdleKick, patchItemHover, patchJrSettings, patchClient }
