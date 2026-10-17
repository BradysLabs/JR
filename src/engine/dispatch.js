'use strict'

const { EventEmitter } = require('events')
const { Limiter } = require('./limiter')
const { xtIn, decode } = require('./codec')

const ANY = '*'

/** Plugin-facing direction names. 'aj' = from the server, 'connection' = from the game. */
const SIDE = { in: 'aj', out: 'connection' }

/**
 * The hub between the proxy and plugins: packet hooks, sending, shared state
 * and console commands. One Dispatch per JR profile.
 */
class Dispatch extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.packetsPerSecond=20] limit for packets plugins send to the server
   * @param {(entry: {type: string, message: string}) => void} [options.log]
   */
  constructor ({ packetsPerSecond = 20, log = () => {} } = {}) {
    super()
    this.setMaxListeners(0)
    this.hooks = { aj: new Map(), connection: new Map() }
    this.commands = new Map()
    this.state = Object.create(null)
    this.limiter = new Limiter({ perSecond: packetsPerSecond })
    this.log = log
    this.session = null
    this._watchers = new Set()
    this._intervals = new Set()
    this._installDefaults()
  }

  /* -------------------------------------------------------- connection */

  get connected () { return !!this.session }

  /** Called by the proxy when the game connects. */
  attach (session) {
    this.session = session
    this.emit('connected')
  }

  /** Called by the proxy when the game or server disconnects. */
  detach () {
    if (!this.session) return
    this.session = null
    this.limiter.clear('Disconnected')
    for (const id of this._intervals) clearInterval(id)
    this._intervals.clear()
    this.emit('disconnected')
  }

  /* ------------------------------------------------------------- hooks */

  /**
   * Hooks packets.
   * @param {object} hook
   * @param {'aj'|'connection'|'*'} hook.type   which side the packet comes from
   * @param {string} [hook.message]             the command, e.g. "rj"; leave out for every packet
   * @param {(ctx: {type: string, message: import('./codec').Packet, dispatch: Dispatch}) => any} hook.callback
   */
  onMessage ({ type = ANY, message = ANY, callback }) {
    if (typeof callback !== 'function') throw new TypeError('onMessage needs a callback function')
    for (const side of sidesOf(type)) {
      const map = this.hooks[side]
      if (!map.has(message)) map.set(message, [])
      map.get(message).push(callback)
    }
    return this
  }

  offMessage ({ type = ANY, message = ANY, callback }) {
    for (const side of sidesOf(type)) {
      const list = this.hooks[side].get(message)
      if (!list) continue
      const i = list.indexOf(callback)
      if (i !== -1) list.splice(i, 1)
      if (!list.length) this.hooks[side].delete(message)
    }
    return this
  }

  /**
   * Runs a packet from the proxy through the hooks. Hooks for its command run
   * first, then hooks for every packet. A hook may change packet.value or set
   * packet.send = false. Async hooks are awaited, in order.
   */
  async process (packet) {
    const side = SIDE[packet.direction]
    const map = this.hooks[side]
    const lists = [packet.type && map.get(packet.type), map.get(ANY)]
    for (const list of lists) {
      if (!list) continue
      for (const callback of list.slice()) {
        try {
          const result = callback({ type: side, message: packet, dispatch: this })
          if (result && typeof result.then === 'function') await result
        } catch (error) {
          this.log({ type: 'error', message: `A plugin hook for "${packet.type}" failed: ${error && error.message}` })
        }
      }
    }
    this._notify(packet, packet.send ? packet.toMessage() : packet.raw, !packet.send)
    return packet
  }

  /**
   * Watches every packet, read-only, including ones plugins send.
   * @returns {() => void} call to stop watching
   */
  onPacket (fn) {
    this._watchers.add(fn)
    return () => this._watchers.delete(fn)
  }

  _notify (packet, raw, blocked) {
    if (!this._watchers.size) return
    const view = {
      raw,
      direction: packet.direction,
      type: packet.type,
      format: packet.format,
      fromPlugin: !!packet.fromPlugin,
      blocked: !!blocked,
      timestamp: packet.timestamp
    }
    for (const fn of this._watchers) {
      try { fn(view) } catch (_) {}
    }
  }

  /* ----------------------------------------------------------- sending */

  /** Sends a packet to the server. Waits its turn under the packet limit. */
  sendRemoteMessage (text) {
    text = clean(text)
    return this.limiter.run(() => {
      if (!this.session) throw new Error('Not connected to Animal Jam.')
      this.session.toServer(text)
      this._notifyText(text, 'out')
    })
  }

  /** Sends a packet to your own game only. */
  sendConnectionMessage (text) {
    text = clean(text)
    if (!this.session) throw new Error('Not connected to Animal Jam.')
    this.session.toGame(text)
    this._notifyText(text, 'in')
  }

  /**
   * Sends several packets.
   * @param {{type?: 'aj'|'connection', messages: string[], delay?: number}} options
   *   type 'aj' sends to the server (the default), 'connection' to the game
   */
  async sendMultipleMessages ({ type = 'aj', messages = [], delay = 0 }) {
    for (const text of messages) {
      if (type === 'connection') this.sendConnectionMessage(text)
      else await this.sendRemoteMessage(text)
      if (delay) await this.wait(delay)
    }
  }

  /** Shows a message box in your game. */
  serverMessage (text) {
    this.sendConnectionMessage(xtIn('ua', String(text).replace(/%/g, ''), 0))
  }

  _notifyText (text, direction) {
    if (!this._watchers.size) return
    const packet = decode(text, direction)
    packet.fromPlugin = true
    this._notify(packet, text, false)
  }

  /* ------------------------------------------------------------- state */

  getState (key) { return this.state[key] }

  setState (key, value) {
    this.state[key] = value
    this.emit('state', key, value)
    return this
  }

  _installDefaults () {
    // %xt%rj%<previous room>%<success>%<room name>%<joined room>%...
    this.onMessage({
      type: 'aj',
      message: 'rj',
      callback: ({ message }) => {
        const [, , , , success, roomName, roomId] = message.value
        if (success !== '1' || !/^\d+$/.test(roomId || '')) return
        this.setState('room', roomId)
        this.setState('internalRoomId', roomId)
        this.setState('roomName', roomName)
      }
    })
    this.onMessage({
      type: 'aj',
      message: 'login',
      callback: ({ message }) => {
        const o = message.value && message.value.b && message.value.b.o
        if (!o || !o.params) return
        this.setState('player', o.params)
        this.log({ type: 'success', message: 'Logged in to Animal Jam.' })
      }
    })
  }

  /* ---------------------------------------------------------- commands */

  /**
   * Adds a console command.
   * @param {{name: string, description?: string, callback: (ctx: {parameters: string[], dispatch: Dispatch}) => any}} command
   */
  onCommand ({ name, description = '', callback }) {
    if (!name || typeof callback !== 'function') throw new TypeError('onCommand needs a name and a callback')
    this.commands.set(String(name).toLowerCase(), { name, description, callback })
    return this
  }

  offCommand ({ name }) {
    this.commands.delete(String(name).toLowerCase())
    return this
  }

  /** Runs a line typed in JR's console. Returns false if no command matched. */
  async runCommand (line) {
    const [name, ...parameters] = String(line).trim().split(/\s+/)
    const command = name && this.commands.get(name.replace(/^[!/]/, '').toLowerCase())
    if (!command) return false
    try {
      await command.callback({ parameters, dispatch: this })
    } catch (error) {
      this.log({ type: 'error', message: `${command.name}: ${error && error.message}` })
    }
    return true
  }

  /* ----------------------------------------------------------- helpers */

  wait (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

  /** An interval JR stops when the game disconnects. */
  setInterval (fn, ms) {
    const id = setInterval(fn, ms)
    this._intervals.add(id)
    return id
  }

  clearInterval (id) {
    clearInterval(id)
    this._intervals.delete(id)
  }
}

function sidesOf (type) {
  if (type === ANY) return ['aj', 'connection']
  if (type === 'aj' || type === 'connection') return [type]
  throw new TypeError(`Unknown hook type "${type}" (use 'aj', 'connection' or '*')`)
}

function clean (text) {
  if (typeof text !== 'string' || !text) throw new TypeError('A packet must be non-empty text')
  return text.replace(/\0+$/, '')
}

module.exports = { Dispatch, ANY }
