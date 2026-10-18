'use strict'

/**
 * Discord Rich Presence: shows "JR" on your Discord profile, with a button
 * to join the JR server. Talks to the Discord app on this computer through
 * its local connection (a named pipe on Windows, a socket elsewhere), so no
 * login or token is involved. If Discord isn't open, JR keeps trying quietly.
 *
 * Frames: int32 LE opcode, int32 LE length, JSON.
 *   0 handshake { v: 1, client_id }    1 command/event    2 close
 */

const net = require('net')
const path = require('path')
const { EventEmitter } = require('events')

const OP = { handshake: 0, frame: 1, close: 2, ping: 3, pong: 4 }
const RETRY = 20000

function pipePaths () {
  if (process.platform === 'win32') return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`)
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp'
  const dirs = [base, path.join(base, 'app/com.discordapp.Discord'), path.join(base, 'snap.discord'), path.join(base, '.flatpak/com.discordapp.Discord/xdg-run')]
  const out = []
  for (const d of dirs) for (let i = 0; i < 10; i++) out.push(path.join(d, `discord-ipc-${i}`))
  return out
}

function encode (op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8')
  const head = Buffer.alloc(8)
  head.writeInt32LE(op, 0)
  head.writeInt32LE(json.length, 4)
  return Buffer.concat([head, json])
}

class Presence extends EventEmitter {
  /**
   * @param {{clientId: string, connect?: Function}} options connect(path) -> socket, for tests
   */
  constructor ({ clientId, connect = (p) => net.createConnection(p) }) {
    super()
    this.clientId = clientId
    this.connect = connect
    this.socket = null
    this.ready = false
    this.enabled = true
    this.activity = null
    this.timer = null
    this.buffer = Buffer.alloc(0)
    this.nonce = 0
  }

  start () {
    if (!this.clientId || this.socket || this.stopped) return
    this._try(pipePaths(), 0)
  }

  _try (paths, i) {
    if (this.stopped) return
    if (i >= paths.length) return this._retry()
    let socket
    try { socket = this.connect(paths[i]) } catch (_) { return this._try(paths, i + 1) }
    let opened = false
    socket.once('connect', () => {
      opened = true
      this.socket = socket
      this.buffer = Buffer.alloc(0)
      socket.write(encode(OP.handshake, { v: 1, client_id: this.clientId }))
    })
    socket.on('data', (chunk) => this._data(chunk))
    socket.on('error', () => {})
    socket.on('close', () => {
      if (!opened) return this._try(paths, i + 1)
      const was = this.ready
      this.socket = null
      this.ready = false
      if (was) this.emit('disconnected')
      this._retry()
    })
  }

  _retry () {
    clearTimeout(this.timer)
    if (this.stopped) return
    this.timer = setTimeout(() => this.start(), RETRY)
    if (this.timer.unref) this.timer.unref()
  }

  _data (chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0)
      const len = this.buffer.readInt32LE(4)
      if (this.buffer.length < 8 + len) break
      let msg = null
      try { msg = JSON.parse(this.buffer.subarray(8, 8 + len).toString('utf8')) } catch (_) {}
      this.buffer = this.buffer.subarray(8 + len)
      if (op === OP.ping && this.socket) this.socket.write(encode(OP.pong, msg))
      else if (op === OP.close) { if (this.socket) this.socket.destroy() } else if (msg && msg.evt === 'READY') {
        this.ready = true
        this.emit('ready', msg.data && msg.data.user)
        this._send()
      }
    }
  }

  /** What to show. null clears it. */
  set (activity) {
    this.activity = activity
    this._send()
  }

  setEnabled (on) {
    this.enabled = !!on
    this._send()
  }

  _send () {
    if (!this.ready || !this.socket) return
    const activity = this.enabled ? this.activity : null
    this.socket.write(encode(OP.frame, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: String(++this.nonce) }))
  }

  stop () {
    this.stopped = true
    clearTimeout(this.timer)
    if (this.socket) {
      try { this.socket.write(encode(OP.frame, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: String(++this.nonce) })) } catch (_) {}
      this.socket.destroy()
    }
  }
}

/**
 * What JR shows on Discord for the profiles that are open.
 * @param {{connected: boolean, playing: boolean, room?: string}[]} windows
 * @param {{invite: string, startedAt: number}} options
 */
function activityFor (windows, { invite, startedAt }) {
  const online = windows.filter(w => w.connected)
  const playing = windows.filter(w => w.playing || w.connected)
  let details = 'In the JR launcher'
  let state
  if (online.length === 1) {
    details = 'Playing Animal Jam Classic'
    state = online[0].room ? `In ${online[0].room}` : undefined
  } else if (online.length > 1) {
    details = 'Playing Animal Jam Classic'
    state = `${online.length} accounts online`
  } else if (playing.length) {
    details = 'Starting Animal Jam Classic'
  }
  const activity = {
    details,
    timestamps: { start: Math.floor(startedAt / 1000) },
    assets: { large_image: 'jr', large_text: 'JR by BradysLabs' },
    buttons: [{ label: 'Join the JR Discord', url: invite }],
    instance: false
  }
  if (state) activity.state = state
  return activity
}

module.exports = { Presence, activityFor, encode, pipePaths }
