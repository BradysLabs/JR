/**
 * JR's Discord membership gate.
 *
 * States (emitted as 'change' events with { state, user, reason }):
 *   signed-out   - nobody has signed in yet, or they signed out
 *   signing-in   - waiting for the user to finish in their browser
 *   checking     - asking Discord whether they're in the server
 *   member       - in the server (and has the required role, if set): JR unlocks
 *   not-member   - signed in but not in the server, banned, or missing the role: JR locks
 *   offline      - Discord couldn't be reached and the grace period ran out: JR locks
 *
 * Rules that close the loopholes:
 *  - Membership is checked on every start and again every few minutes while
 *    JR is open, so leaving the server (or being banned) locks JR.
 *  - Identity always comes from Discord's own sign-in, never from anything
 *    the local Discord app or the user can claim.
 *  - If Discord can't be reached, JR only stays open for a short grace period
 *    after the last successful check. A "not a member" answer is never graced.
 */
const { EventEmitter } = require('events')
const crypto = require('crypto')
const { pkce, authorizeUrl, waitForCallback, tokenRequest, simplePage } = require('./oauth')

const DEFAULTS = {
  apiBase: 'https://discord.com/api/v10',
  authorizeUrl: 'https://discord.com/oauth2/authorize',
  redirectUri: 'http://127.0.0.1:53682/callback',
  scopes: ['identify', 'guilds.members.read'],
  recheckMs: 10 * 60 * 1000,
  graceMs: 15 * 60 * 1000,
  requiredRoleId: null
}

class DiscordGate extends EventEmitter {
  /**
   * @param {Object} options
   * @param {string} options.clientId  - Discord application ID (Public Client on).
   * @param {string} options.guildId   - The JR Discord server ID.
   * @param {string} [options.requiredRoleId] - Optional role a member must have.
   * @param {{load:Function, save:Function, clear:Function}} options.store - Where the sign-in is kept (encrypted by the caller).
   * @param {Function} options.openExternal - Opens a URL in the user's browser.
   * @param {Function} [options.fetch] - fetch implementation (defaults to global fetch).
   * @param {Function} [options.now]   - Clock, for tests.
   */
  constructor (options) {
    super()
    this.o = { ...DEFAULTS, ...options }
    if (!this.o.clientId || !this.o.guildId) throw new Error('DiscordGate needs clientId and guildId')
    this.fetch = this.o.fetch || globalThis.fetch
    this.now = this.o.now || Date.now
    this.state = 'signed-out'
    this.user = null
    this.reason = null
    this.lastGoodCheck = 0
    this.timer = null
    this.session = null
  }

  /** Loads a saved sign-in (if any), checks it, and starts the timer. */
  async start () {
    this.session = await this.o.store.load()
    if (!this.session || !this.session.accessToken) {
      this.set('signed-out')
      return this.state
    }
    await this.check()
    this.schedule()
    return this.state
  }

  stop () {
    clearTimeout(this.timer)
    this.timer = null
  }

  /** Opens Discord sign-in in the browser and waits for the user to finish. */
  async signIn ({ silent = false } = {}) {
    this.set('signing-in')
    const { verifier, challenge } = pkce()
    const state = crypto.randomBytes(16).toString('hex')
    const wait = waitForCallback({ redirectUri: this.o.redirectUri, state, page: simplePage, timeoutMs: this.o.signInTimeoutMs })
    await this.o.openExternal(authorizeUrl({ ...this.o, state, challenge, silent }))
    try {
      const code = await wait
      this.session = await tokenRequest(this.fetch, `${this.o.apiBase}/oauth2/token`, {
        client_id: this.o.clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.o.redirectUri,
        code_verifier: verifier
      })
      await this.o.store.save(this.session)
    } catch (error) {
      this.set('signed-out', { reason: error.code === 'access_denied' ? 'cancelled' : 'sign_in_failed' })
      return this.state
    }
    await this.check()
    this.schedule()
    return this.state
  }

  /** Forgets the sign-in on this computer (and tells Discord to revoke it). */
  async signOut () {
    this.stop()
    const token = this.session && this.session.accessToken
    this.session = null
    this.user = null
    await this.o.store.clear()
    if (token) {
      try {
        await this.fetch(`${this.o.apiBase}/oauth2/token/revoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: this.o.clientId, token, token_type_hint: 'access_token' }).toString()
        })
      } catch (_) {}
    }
    this.set('signed-out')
  }

  /** Asks Discord whether the signed-in user is in the server right now. */
  async check () {
    if (!this.session) { this.set('signed-out'); return this.state }
    if (this.state !== 'member') this.set('checking')
    let result
    try {
      if (this.session.expiresAt && this.session.expiresAt - this.now() < 60 * 1000) await this.refresh()
      result = await this.memberRequest()
      if (result.status === 401) {
        await this.refresh()
        result = await this.memberRequest()
      }
    } catch (error) {
      if (error.code === 'needs_sign_in') {
        this.session = null
        await this.o.store.clear()
        this.set('signed-out', { reason: 'expired' })
        return this.state
      }
      return this.unreachable(error)
    }

    if (result.status === 200) {
      const member = result.body || {}
      const u = member.user || {}
      this.user = { id: u.id, username: u.username, globalName: u.global_name || null, avatar: u.avatar || null, nick: member.nick || null }
      if (this.o.requiredRoleId && !(member.roles || []).includes(this.o.requiredRoleId)) {
        this.set('not-member', { reason: 'missing_role' })
      } else {
        this.lastGoodCheck = this.now()
        this.set('member')
      }
    } else if (result.status === 404 || result.status === 403) {
      // 404 Unknown Member / Unknown Guild: not in the server (left, kicked or banned).
      this.set('not-member', { reason: 'not_in_server' })
    } else if (result.status === 401) {
      this.session = null
      await this.o.store.clear()
      this.set('signed-out', { reason: 'expired' })
    } else {
      return this.unreachable(Object.assign(new Error(`HTTP ${result.status}`), { retryAfter: result.retryAfter }))
    }
    return this.state
  }

  async memberRequest () {
    const res = await this.fetch(`${this.o.apiBase}/users/@me/guilds/${this.o.guildId}/member`, {
      headers: { authorization: `Bearer ${this.session.accessToken}` }
    })
    const body = await res.json().catch(() => null)
    return { status: res.status, body, retryAfter: body && body.retry_after }
  }

  async refresh () {
    if (!this.session.refreshToken) throw Object.assign(new Error('Sign-in expired'), { code: 'needs_sign_in' })
    try {
      const next = await tokenRequest(this.fetch, `${this.o.apiBase}/oauth2/token`, {
        client_id: this.o.clientId,
        grant_type: 'refresh_token',
        refresh_token: this.session.refreshToken
      })
      this.session = { ...next, refreshToken: next.refreshToken || this.session.refreshToken }
      await this.o.store.save(this.session)
    } catch (error) {
      if (error.status === 400 || error.status === 401) throw Object.assign(error, { code: 'needs_sign_in' })
      throw error
    }
  }

  /** Discord couldn't answer. Stay open only inside the grace period. */
  unreachable (error) {
    const withinGrace = this.state === 'member' && this.now() - this.lastGoodCheck < this.o.graceMs
    if (!withinGrace) this.set('offline', { reason: 'discord_unreachable' })
    if (error && error.retryAfter) this.schedule(Math.ceil(error.retryAfter * 1000))
    return this.state
  }

  schedule (ms = this.o.recheckMs) {
    clearTimeout(this.timer)
    this.timer = setTimeout(async () => {
      await this.check()
      if (this.session) this.schedule()
    }, ms)
    if (this.timer.unref) this.timer.unref()
  }

  get unlocked () { return this.state === 'member' }

  set (state, { reason = null } = {}) {
    const changed = state !== this.state || reason !== this.reason
    this.state = state
    this.reason = reason
    if (changed) this.emit('change', { state, reason, user: this.user })
  }
}

module.exports = { DiscordGate, DEFAULTS }
