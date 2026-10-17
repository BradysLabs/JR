'use strict'

/**
 * A stand-in for the Animal Jam server and game, for tests.
 *
 * FakeServer speaks just enough SmartFox: answers verChk and login, joins
 * rooms, and echoes anything else back as "%xt%echo%<raw>%". It records every
 * message it receives.
 *
 * FakeGame connects to the JR proxy like the real game would.
 */

const net = require('net')
const tls = require('tls')
const fs = require('fs')
const path = require('path')
const { Framer, frame } = require('../../src/engine/codec')

const CERT = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'cert.pem'), 'utf8')
const KEY = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'key.pem'), 'utf8')

class FakeServer {
  constructor ({ secure = true } = {}) {
    this.secure = secure
    this.received = []
    this.sockets = new Set()
    this.waiters = []
  }

  async start () {
    const onSocket = (socket) => {
      this.sockets.add(socket)
      const framer = new Framer()
      socket.on('data', chunk => {
        for (const text of framer.push(chunk)) {
          this.received.push(text)
          this._reply(socket, text)
          this._check()
        }
      })
      socket.on('close', () => this.sockets.delete(socket))
      socket.on('error', () => {})
    }
    this.server = this.secure ? tls.createServer({ cert: CERT, key: KEY }, onSocket) : net.createServer(onSocket)
    await new Promise(resolve => this.server.listen(0, '127.0.0.1', resolve))
    this.port = this.server.address().port
    return this
  }

  get target () {
    return { host: '127.0.0.1', port: this.port, secure: this.secure, ca: CERT }
  }

  _reply (socket, text) {
    const send = (t) => socket.write(frame(t))
    if (text.includes("action='verChk'")) return send("<msg t='sys'><body action='apiOK' r='0'></body></msg>")
    if (text.includes("action='login'")) {
      return send(JSON.stringify({ t: 'xt', b: { r: -1, o: { _cmd: 'login', params: { userName: 'TestJammer', accountType: 1 }, statusId: 1 } } }))
    }
    if (text.startsWith('%xt%o%rj%')) {
      const name = text.split('%')[5]
      return send(`%xt%rj%-1%1%${name}%844480%`)
    }
    if (text.startsWith('%xt%o%')) return send(`%xt%echo%-1%${text.split('%')[3]}%`)
  }

  /** Pushes a message to every connected game. */
  push (text) {
    for (const s of this.sockets) s.write(frame(text))
  }

  /** Resolves once a received message matches. */
  waitFor (test, timeout = 2000) {
    return waitList(this, test, timeout)
  }

  _check () { checkList(this) }

  drop () { for (const s of this.sockets) s.destroy() }

  async stop () {
    this.drop()
    await new Promise(resolve => this.server.close(() => resolve()))
  }
}

class FakeGame {
  constructor (port) {
    this.port = port
    this.received = []
    this.waiters = []
  }

  connect () {
    return new Promise((resolve, reject) => {
      const framer = new Framer()
      this.socket = net.connect({ host: '127.0.0.1', port: this.port }, () => resolve(this))
      this.socket.on('data', chunk => {
        for (const text of framer.push(chunk)) {
          this.received.push(text)
          checkList(this)
        }
      })
      this.socket.on('error', reject)
      this.closed = new Promise(resolve => this.socket.on('close', resolve))
    })
  }

  send (text) { this.socket.write(frame(text)) }

  /** Sends raw bytes, for framing tests. */
  write (bytes) { this.socket.write(bytes) }

  waitFor (test, timeout = 2000) { return waitList(this, test, timeout) }

  close () { this.socket.destroy() }
}

function matcher (test) {
  if (typeof test === 'function') return test
  if (test instanceof RegExp) return t => test.test(t)
  return t => t.includes(test)
}

function waitList (owner, test, timeout) {
  const fn = matcher(test)
  const found = owner.received.find(fn)
  if (found) return Promise.resolve(found)
  return new Promise((resolve, reject) => {
    const w = { fn, resolve }
    w.timer = setTimeout(() => {
      owner.waiters.splice(owner.waiters.indexOf(w), 1)
      reject(new Error(`Timed out waiting for ${test}. Got: ${JSON.stringify(owner.received)}`))
    }, timeout)
    owner.waiters.push(w)
  })
}

function checkList (owner) {
  for (const w of owner.waiters.slice()) {
    const found = owner.received.find(w.fn)
    if (found) {
      clearTimeout(w.timer)
      owner.waiters.splice(owner.waiters.indexOf(w), 1)
      w.resolve(found)
    }
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

module.exports = { FakeServer, FakeGame, sleep, CERT }
