'use strict'

const { StringDecoder } = require('string_decoder')

/**
 * JR packet codec.
 *
 * Animal Jam Classic talks to its SmartFoxServer in three text formats, each
 * message ending with a NUL byte on the wire:
 *
 *   xt    %xt%o%rj%844480%denName%        (game -> server, "o" marks outgoing)
 *         %xt%rj%-1%1%denName%844480%     (server -> game)
 *   json  {"t":"xt","b":{"r":-1,"o":{"_cmd":"login","params":{...}}}}
 *   xml   <msg t='sys'><body action='verChk' r='0'><ver v='165'/></body></msg>
 *
 * decode() turns one message into a Packet. Plugins read and change
 * packet.value, set packet.send = false to drop it, and the proxy writes
 * packet.toMessage() to the other side.
 */

const OUT = 'out' // game -> server
const IN = 'in' // server -> game

class Packet {
  /**
   * @param {object} fields
   * @param {'xt'|'json'|'xml'|'text'} fields.format
   * @param {string|null} fields.type   the command, e.g. "rj" or "login"
   * @param {*} fields.value
   * @param {string} fields.raw
   * @param {'in'|'out'} fields.direction
   */
  constructor ({ format, type, value, raw, direction }) {
    this.format = format
    this.type = type
    this.value = value
    this.raw = raw
    this.direction = direction
    this.send = true
    this.fromPlugin = false
    this.timestamp = Date.now()
  }

  /**
   * The packet as text, including any changes made to `value`. Unchanged
   * packets come back exactly as received (byte for byte), because the game
   * server is picky about details like `<a></a>` versus `<a />`.
   */
  toMessage () {
    const text = this._serialize()
    if (this._pristine !== undefined && text === this._pristine) return this.raw
    return text
  }

  _serialize () {
    switch (this.format) {
      case 'xt': return Array.isArray(this.value) ? this.value.join('%') : String(this.value)
      case 'json': return typeof this.value === 'string' ? this.value : JSON.stringify(this.value)
      case 'xml': return typeof this.value === 'string' ? this.value : xml.stringify(this.value)
      default: return String(this.value)
    }
  }

  /** Remembers how the untouched packet serializes, to spot changes later. */
  _seal () {
    if (this.format === 'xml' || this.format === 'json') this._pristine = this._serialize()
    return this
  }

  toString () { return this.toMessage() }
}

/** Index of the command inside a split xt packet. */
function xtCommandIndex (parts, direction) {
  // Outgoing packets carry an extra "o" after "xt".
  if (direction === OUT || parts[2] === 'o') return 3
  return 2
}

function formatOf (raw) {
  const c = raw.charCodeAt(0)
  if (c === 37 /* % */) return 'xt'
  if (c === 123 /* { */) return 'json'
  if (c === 60 /* < */) return 'xml'
  return 'text'
}

/**
 * @param {string} raw one message without its NUL terminator
 * @param {'in'|'out'} direction
 * @returns {Packet}
 */
function decode (raw, direction) {
  const format = formatOf(raw)

  if (format === 'xt') {
    const parts = raw.split('%')
    const type = parts[xtCommandIndex(parts, direction)] || null
    return new Packet({ format, type, value: parts, raw, direction })
  }

  if (format === 'json') {
    try {
      const value = JSON.parse(raw)
      const o = value && value.b && value.b.o
      const type = (o && (o._cmd || o.cmd)) || null
      return new Packet({ format, type, value, raw, direction })._seal()
    } catch (_) {
      return new Packet({ format: 'text', type: null, value: raw, raw, direction })
    }
  }

  if (format === 'xml') {
    try {
      const value = xml.parse(raw)
      return new Packet({ format, type: xml.commandOf(value), value, raw, direction })._seal()
    } catch (_) {
      return new Packet({ format: 'text', type: null, value: raw, raw, direction })
    }
  }

  return new Packet({ format, type: null, value: raw, raw, direction })
}

/* ------------------------------------------------------------------ xml */

/**
 * A small XML reader for SmartFox messages. Elements become
 * { name, attrs, children } and text becomes { text } (with cdata: true when
 * it came from a CDATA section), so the message can be written back
 * unchanged.
 */
const xml = {
  parse (src) {
    let i = 0
    const root = { name: '#root', attrs: {}, children: [] }
    const stack = [root]
    const top = () => stack[stack.length - 1]

    while (i < src.length) {
      if (src.startsWith('<![CDATA[', i)) {
        const end = src.indexOf(']]>', i + 9)
        if (end === -1) throw new Error('Unclosed CDATA')
        top().children.push({ text: src.slice(i + 9, end), cdata: true })
        i = end + 3
      } else if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i + 4)
        if (end === -1) throw new Error('Unclosed comment')
        i = end + 3
      } else if (src.startsWith('<?', i)) {
        const end = src.indexOf('?>', i + 2)
        if (end === -1) throw new Error('Unclosed declaration')
        i = end + 2
      } else if (src.startsWith('</', i)) {
        const end = src.indexOf('>', i)
        if (end === -1) throw new Error('Unclosed tag')
        const name = src.slice(i + 2, end).trim()
        const el = stack.pop()
        if (!el || el.name !== name) throw new Error(`Unexpected </${name}>`)
        i = end + 1
      } else if (src[i] === '<') {
        const tag = readTag(src, i)
        const el = { name: tag.name, attrs: tag.attrs, children: [] }
        top().children.push(el)
        if (!tag.selfClosing) stack.push(el)
        i = tag.end
      } else {
        const next = src.indexOf('<', i)
        const end = next === -1 ? src.length : next
        const text = src.slice(i, end)
        if (text.trim()) top().children.push({ text: unescape(text) })
        i = end
      }
    }
    if (stack.length !== 1) throw new Error(`Unclosed <${top().name}>`)
    const elements = root.children.filter(c => c.name)
    if (elements.length !== 1) throw new Error('Expected one root element')
    return elements[0]
  },

  stringify (el) {
    if (el.text !== undefined) return el.cdata ? `<![CDATA[${el.text}]]>` : escape(el.text)
    const attrs = Object.entries(el.attrs || {}).map(([k, v]) => ` ${k}='${escape(String(v))}'`).join('')
    const kids = el.children || []
    if (!kids.length) return `<${el.name}${attrs} />`
    return `<${el.name}${attrs}>${kids.map(xml.stringify).join('')}</${el.name}>`
  },

  /** First descendant element called `name`. */
  find (el, name) {
    for (const c of el.children || []) {
      if (c.name === name) return c
      const deep = c.name && xml.find(c, name)
      if (deep) return deep
    }
    return null
  },

  /** All text inside an element. */
  text (el) {
    if (!el) return ''
    if (el.text !== undefined) return el.text
    return (el.children || []).map(xml.text).join('')
  },

  /** The command of a SmartFox xml message: the action of its <body>. */
  commandOf (el) {
    if (el.name === 'policy-file-request') return 'policy-file-request'
    const body = el.name === 'body' ? el : xml.find(el, 'body')
    return (body && body.attrs.action) || el.name || null
  }
}

function readTag (src, start) {
  let i = start + 1
  const nameMatch = /^[^\s/>]+/.exec(src.slice(i))
  if (!nameMatch) throw new Error('Bad tag')
  const name = nameMatch[0]
  i += name.length
  const attrs = {}
  const attrRe = /\s*([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/y
  for (;;) {
    attrRe.lastIndex = i
    const m = attrRe.exec(src)
    if (!m) break
    attrs[m[1]] = unescape(m[3] !== undefined ? m[3] : m[4])
    i = attrRe.lastIndex
  }
  while (/\s/.test(src[i] || '')) i++
  let selfClosing = false
  if (src[i] === '/') { selfClosing = true; i++ }
  if (src[i] !== '>') throw new Error(`Bad tag <${name}>`)
  return { name, attrs, selfClosing, end: i + 1 }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function unescape (s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : m
  })
}
function escape (s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;').replace(/"/g, '&quot;')
}

/* --------------------------------------------------------------- framing */

/**
 * Splits a byte stream into NUL-terminated messages. Handles messages split
 * across chunks, several messages in one chunk, and multi-byte characters
 * split across chunks.
 */
class Framer {
  constructor ({ maxLength = 4 * 1024 * 1024 } = {}) {
    this.decoder = new StringDecoder('utf8')
    this.buffer = ''
    this.maxLength = maxLength
  }

  /** @returns {string[]} the complete messages in this chunk */
  push (chunk) {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    const parts = this.buffer.split('\0')
    this.buffer = parts.pop()
    if (this.buffer.length > this.maxLength) {
      this.buffer = ''
      throw new Error('Message too long')
    }
    return parts.filter(p => p.length)
  }
}

/** One message ready for the wire. */
function frame (text) {
  return Buffer.from(text.endsWith('\0') ? text : text + '\0', 'utf8')
}

/* ------------------------------------------------------------- builders */

/** Builds an outgoing xt packet: xtOut('rj', room, 'denName') */
function xtOut (command, room, ...params) {
  return `%xt%o%${command}%${room}%${params.length ? params.join('%') + '%' : ''}`
}

/** Builds an incoming xt packet: xtIn('ua', 'Hello', 0) */
function xtIn (command, ...params) {
  return `%xt%${command}%${params.length ? params.join('%') + '%' : ''}`
}

module.exports = { Packet, decode, xml, Framer, frame, xtOut, xtIn, IN, OUT }
