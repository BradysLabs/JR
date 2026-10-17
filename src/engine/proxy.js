'use strict'

const net = require('net')
const tls = require('tls')
const { EventEmitter } = require('events')
const { decode, Framer, frame, IN, OUT } = require('./codec')

const POLICY = '<?xml version="1.0"?><cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>'

/**
 * JR's game proxy. The game connects here instead of to Animal Jam; JR opens
 * the real connection and passes every message through the Dispatch so
 * plugins can watch, change or block it.
 *
 *   game  --plain TCP-->  Proxy  --TLS-->  Animal Jam server
 *
 * Events: 'listening', 'session' (session), 'close-session' (reason),
 * 'log' ({type, message}).
 */
class Proxy extends EventEmitter {
  /**
   * @param {object} options
   * @param {import('./dispatch').Dispatch} options.dispatch
   * @param {() => ({host: string, port?: number, secure?: boolean, verify?: boolean, ca?: string})} options.upstream
   *   where the real server is; asked again for each connection
   * @param {string} [options.host='127.0.0.1']
   * @param {number} [options.port=0] 0 picks a free port (see .port after listen)
   */
  constructor ({ dispatch, upstream, host = '127.0.0.1', port = 0 }) {
    super()
    if (!dispatch) throw new TypeError('Proxy needs a dispatch')
    if (typeof upstream !== 'function') throw new TypeError('Proxy needs an upstream() function')
    this.dispatch = dispatch
    this.upstream = upstream
    this.host = host
    this.wantedPort = port
    this.server = null
    this.current = null
  }

  get port () {
    const a = this.server && this.server.address()
    return a ? a.port : null
  }

  listen () {
    return new Promise((resolve, reject) => {
      const server = net.createServer(socket => this._accept(socket))
      const onError = (error) => {
        server.removeListener('listening', onListening)
        reject(friendlyListenError(error, this.host, this.wantedPort))
      }
      const onListening = () => {
        server.removeListener('error', onError)
        server.on('error', e => this._log('error', `Proxy error: ${e.message}`))
        this.server = server
        this.emit('listening', this.port)
        resolve(this.port)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.wantedPort, this.host)
    })
  }

  async close () {
    if (this.current) this.current.close('JR is closing')
    const server = this.server
    this.server = null
    if (server) await new Promise(resolve => server.close(() => resolve()))
  }

  _accept (game) {
    game.setNoDelay(true)
    const session = new Session(this, game)
    // Only one game per profile. A new game connection replaces the old one
    // (policy requests don't count).
    session.once('claim', () => {
      if (this.current && this.current !== session) this.current.close('The game connected again')
      this.current = session
    })
    session.once('closed', (reason) => {
      if (this.current === session) {
        this.current = null
        this.dispatch.detach()
      }
      this.emit('close-session', reason)
    })
  }

  _log (type, message) {
    this.emit('log', { type, message })
    this.dispatch.log({ type, message })
  }
}

/** One game connection and its matching server connection. */
class Session extends EventEmitter {
  constructor (proxy, game) {
    super()
    this.proxy = proxy
    this.dispatch = proxy.dispatch
    this.game = game
    this.server = null
    this.closed = false
    this.serverReady = false
    this.pendingToServer = [] // game messages that arrived before the server was connected
    this.gameFramer = new Framer()
    this.serverFramer = new Framer()
    // One chain per direction keeps messages in order even with async hooks.
    this.chain = { [OUT]: Promise.resolve(), [IN]: Promise.resolve() }

    game.on('data', chunk => this._fromGame(chunk))
    game.on('error', e => this.close(`Game connection error: ${e.message}`))
    game.on('close', () => this.close('The game disconnected'))
  }

  _fromGame (chunk) {
    let messages
    try { messages = this.gameFramer.push(chunk) } catch (e) { return this.close(e.message) }
    for (const text of messages) {
      // Flash asks for a socket policy on its own short connection.
      if (text.startsWith('<policy-file-request')) {
        this.game.end(frame(POLICY))
        this.policyOnly = true
        return
      }
      if (!this.server) {
        this.emit('claim')
        this._connectServer()
      }
      this._enqueue(OUT, text)
    }
  }

  _connectServer () {
    let target
    try { target = this.proxy.upstream() } catch (e) { return this.close(`No server to connect to: ${e.message}`) }
    const { host, port = 443, secure = true, verify = true, ca } = target || {}
    if (!host) return this.close('No server to connect to')

    const onConnect = () => {
      this.serverReady = true
      this.dispatch.attach({
        toServer: (text) => this._write(this.server, text),
        toGame: (text) => this._write(this.game, text)
      })
      this.proxy.emit('session', this)
      this.proxy._log('success', `Connected to ${host}.`)
      for (const text of this.pendingToServer.splice(0)) this._write(this.server, text)
    }

    this.server = secure
      ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: verify, ca }, onConnect)
      : net.connect({ host, port }, onConnect)
    this.server.setNoDelay(true)
    this.server.on('data', chunk => {
      let messages
      try { messages = this.serverFramer.push(chunk) } catch (e) { return this.close(e.message) }
      for (const text of messages) this._enqueue(IN, text)
    })
    this.server.on('error', e => this.close(`Server connection error: ${e.message}`))
    this.server.on('close', () => this.close('The server disconnected'))
  }

  _enqueue (direction, text) {
    this.chain[direction] = this.chain[direction].then(async () => {
      if (this.closed) return
      const packet = decode(text, direction)
      await this.dispatch.process(packet)
      if (!packet.send || this.closed) return
      const out = packet.toMessage()
      if (direction === OUT) {
        if (this.serverReady) this._write(this.server, out)
        else this.pendingToServer.push(out)
      } else {
        this._write(this.game, out)
      }
    }).catch(e => this.proxy._log('error', `Packet error: ${e.message}`))
  }

  _write (socket, text) {
    if (this.closed || !socket || socket.destroyed) throw new Error('Not connected to Animal Jam.')
    socket.write(frame(text))
  }

  close (reason) {
    if (this.closed) return
    this.closed = true
    if (this.game && !this.game.destroyed) this.game.destroy()
    if (this.server && !this.server.destroyed) this.server.destroy()
    if (!this.policyOnly) this.proxy._log('notify', `Disconnected: ${reason}.`)
    this.emit('closed', reason)
  }
}

function friendlyListenError (error, host, port) {
  if (error.code === 'EADDRINUSE') return new Error(`Port ${port} on ${host} is already in use. Close the other program using it, or let JR pick a port.`)
  if (error.code === 'EACCES') return new Error(`JR isn't allowed to use port ${port}. Let JR pick a port instead.`)
  return error
}

module.exports = { Proxy, POLICY }
