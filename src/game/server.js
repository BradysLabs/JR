'use strict'

/**
 * JR's small local web server for the game (one per profile, 127.0.0.1 only).
 *
 *   POST /game/session          the game says which Animal Jam server it was
 *                               given; JR remembers it and answers with its
 *                               proxy's address instead
 *   GET  /client/<v>/ajclient.swf   the official game file, patched on this
 *                               computer so it talks to JR without TLS
 *   *    /content/...           passed through to Animal Jam's content server
 *   *    /md/...                passed through to Animal Jam's media server
 *   GET  /crossdomain.xml       lets the game load from here
 */

const http = require('http')
const path = require('path')
const { EventEmitter } = require('events')
const fs = (() => { try { return require('original-fs') } catch (_) { return require('fs') } })()
const swf = require('./swf')

const CLIENT_PATCH = 3
const { request } = require('./http')

const CROSSDOMAIN = '<?xml version="1.0"?><cross-domain-policy><allow-access-from domain="*" /></cross-domain-policy>'
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length', 'host', 'upgrade', 'proxy-connection'])

/** Turns an internal game host into the public one players connect to. */
function publicHost (host) {
  if (!host) return host
  const m = /^(.*)\.(stage|prod)\.animaljam\.internal$/.exec(host)
  if (m) return `lb-${m[1]}-${m[2]}.animaljam.com`
  // "iss01-classic-prod.animaljam.com" is Animal Jam's private address;
  // players reach the same server through its "lb-" (load balancer) name.
  if (/^iss\d+[\w-]*\.animaljam\.com$/i.test(host)) return `lb-${host}`
  return host
}

/**
 * Works out where the game would have connected.
 * @returns {{host: string, port: number}}
 */
function upstreamFrom (flashVars) {
  if (flashVars.ingressXt && /^[^:]+:\d+$/.test(flashVars.ingressXt)) {
    const [host, port] = flashVars.ingressXt.split(':')
    return { host: publicHost(host), port: Number(port) }
  }
  if (!flashVars.smartfoxServer) throw new Error('No game server in the login data')
  return { host: publicHost(flashVars.smartfoxServer), port: Number(flashVars.smartfoxPort) || 443 }
}

class GameServer extends EventEmitter {
  /**
   * @param {object} options
   * @param {() => number} options.proxyPort the profile's game proxy port
   * @param {string} options.cacheDir where patched game files are kept
   * @param {(e: {type: string, message: string}) => void} [options.log]
   * @param {typeof request} [options.request] HTTP client (Node-based by default)
   */
  constructor ({ proxyPort, cacheDir, log = () => {}, request: http = request, clientOptions = () => ({}) }) {
    super()
    this.proxyPort = proxyPort
    this.cacheDir = cacheDir
    this.clientOptions = clientOptions
    this.log = log
    this.http = http
    this.session = null
    this.server = null
    this.patching = new Map()
  }

  get port () { return this.server ? this.server.address().port : null }
  get url () { return `http://127.0.0.1:${this.port}` }

  listen (port = 0) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this._handle(req, res).catch((error) => {
          this.log({ type: 'error', message: `Game file request failed: ${error.message}` })
          if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' })
          res.end('JR could not load this file.')
        })
      })
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject)
        this.server = server
        resolve(this.port)
      })
    })
  }

  close () {
    return new Promise(resolve => (this.server ? this.server.close(() => resolve()) : resolve()))
  }

  /** Where the proxy should connect for the current session. */
  upstream () {
    if (!this.session) throw new Error('The game hasn\'t logged in through JR yet')
    return this.session.upstream
  }

  async _handle (req, res) {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname !== '/game/session') this.requests = (this.requests || 0) + 1
    if (this.requests <= 40 || url.pathname.includes('ajclient')) this.log({ type: 'debug', message: `Game asked for ${req.method} ${url.pathname}` })
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }

    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }

    if (url.pathname === '/game/session' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      const answer = this.startSession(body)
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(answer))
    }

    if (url.pathname === '/crossdomain.xml') {
      res.writeHead(200, { 'Content-Type': 'text/xml' })
      return res.end(CROSSDOMAIN)
    }

    const client = /^\/client\/([\w.-]+)\/ajclient\.swf$/.exec(url.pathname)
    if (client) {
      const file = await this.patchedClient(client[1])
      res.writeHead(200, { 'Content-Type': 'application/x-shockwave-flash', 'Content-Length': file.length, 'Cache-Control': 'no-cache' })
      return res.end(file)
    }

    const pass = /^\/(content|md)\/(.*)$/.exec(url.pathname)
    if (pass && this.session) {
      const base = pass[1] === 'content' ? this.session.content : this.session.mdUrl
      if (!base) { res.writeHead(404); return res.end() }
      return this._passThrough(req, res, new URL(pass[2] + url.search, base).toString())
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  }

  /**
   * Remembers the real server and returns what the game should use instead.
   * Only connection addresses are sent here, never login details.
   */
  startSession (flashVars) {
    const upstream = upstreamFrom(flashVars)
    const version = String(flashVars.deploy_version || '').replace(/[^\w.-]/g, '')
    this.session = {
      upstream,
      originalServer: flashVars.smartfoxServer || upstream.host,
      content: ensureSlash(flashVars.content),
      mdUrl: flashVars.mdUrl ? ensureSlash(flashVars.mdUrl) : null,
      clientURL: flashVars.clientURL || (flashVars.content && version ? `${ensureSlash(flashVars.content)}${version}/ajclient.swf` : null),
      version,
      startedAt: Date.now()
    }
    const port = String(this.proxyPort())
    // The game connects straight to JR. ingressXt is cleared on purpose:
    // with it set, the game thinks it's behind Animal Jam's load balancer and
    // sends routing messages the real server rejects.
    const answer = {
      smartfoxServer: '127.0.0.1',
      smartfoxPort: port,
      ingressXt: ''
    }
    for (const key of Object.keys(flashVars)) if (/^smartfoxServer\d+$/.test(key)) answer[key] = '127.0.0.1'
    if (this.session.content) answer.content = `${this.url}/content/`
    if (this.session.mdUrl) answer.mdUrl = `${this.url}/md/`
    if (this.session.clientURL) answer.clientURL = `${this.url}/client/${version || 'current'}/ajclient.swf`
    this.emit('session', { server: serverName(upstream.host), upstream, version })
    this.log({ type: 'notify', message: `Game is logging in to ${serverName(upstream.host)}.` })
    return answer
  }

  /** The official client for this version, with secure mode turned off. Cached. */
  async patchedClient (version) {
    // Bump CLIENT_PATCH when JR's changes to the game file change, so old copies aren't reused.
    const options = this.clientOptions() || {}
    const variant = options.antiIdle ? '-awake' : ''
    const file = path.join(this.cacheDir, `ajclient-${version}-jr${CLIENT_PATCH}${variant}.swf`)
    if (fs.existsSync(file)) return fs.readFileSync(file)
    const jobKey = version + variant
    if (this.patching.has(jobKey)) return this.patching.get(jobKey)
    const job = (async () => {
      const source = this.session && this.session.clientURL
      if (!source) throw new Error('No game file address yet')
      const response = await this.http(source)
      if (!response.ok) throw new Error(`Animal Jam answered ${response.status} for the game file`)
      const original = await response.buffer()
      const result = swf.patchClient(original, { antiIdle: !!options.antiIdle })
      if (options.antiIdle && result.idleKick === 'missing') this.log({ type: 'warn', message: 'Couldn\u2019t find the idle logout in this game version; Anti-kick may not work.' })
      if (result.shopRefresh === 'missing') this.log({ type: 'warn', message: 'Couldn\u2019t find the My Shop screen in this game version; refills may only show after you log in again.' })
      fs.mkdirSync(this.cacheDir, { recursive: true })
      fs.writeFileSync(file, result.swf)
      this.log({ type: 'success', message: `Prepared game version ${version}.` })
      return result.swf
    })()
    this.patching.set(jobKey, job)
    try { return await job } finally { this.patching.delete(jobKey) }
  }

  async _passThrough (req, res, target) {
    const headers = {}
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_HEADERS.has(k) && k !== 'origin' && k !== 'referer') headers[k] = v
    const init = { method: req.method, headers }
    if (req.method !== 'GET' && req.method !== 'HEAD') init.body = await readBody(req)
    const upstream = await this.http(target, init)
    const out = {}
    for (const [k, v] of Object.entries(upstream.headers)) if (!HOP_HEADERS.has(k)) out[k] = v
    res.writeHead(upstream.status, out)
    if (req.method === 'HEAD') { upstream.stream.resume(); return res.end() }
    upstream.stream.pipe(res)
  }
}

function readBody (req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', c => {
      size += c.length
      if (size > 5 * 1024 * 1024) { reject(new Error('Request too large')); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function ensureSlash (u) { return u ? (u.endsWith('/') ? u : u + '/') : u }

/** "lb-iss02-classic-prod.animaljam.com" -> "iss02" */
function serverName (host) {
  const m = /(iss\d+|\bs\d+)/i.exec(host || '')
  return m ? m[1].toLowerCase() : host
}

module.exports = { GameServer, upstreamFrom, publicHost, serverName }
