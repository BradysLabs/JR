/**
 * Tests the Discord gate against a fake Discord. Run: node test/run.js
 * The fake plays both the browser (it "approves" sign-in by calling the
 * callback) and Discord's API (token + member endpoints).
 */
const assert = require('assert')
const http = require('http')
const crypto = require('crypto')
const { DiscordGate } = require('../src/discord/gate')

let passed = 0
const ok = (label) => { passed++; console.log('  ok  ' + label) }

const GUILD = '111'
const fake = {
  members: new Set(['42']),
  roles: { 42: ['900'] },
  tokens: new Map(), // access token -> user id
  refresh: new Map(), // refresh token -> user id
  challenges: new Map(),
  down: false,
  rateLimited: false,
  expireNext: false,
  lastAuthorize: null,
  user: '42',
  approve: true
}

const api = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (fake.down) return send(503, { message: 'down' })
  let body = ''
  for await (const chunk of req) body += chunk
  const form = new URLSearchParams(body)

  if (u.pathname === '/oauth2/token') {
    assert.ok(!form.get('client_secret'), 'never sends a client secret')
    let userId
    if (form.get('grant_type') === 'authorization_code') {
      const entry = fake.challenges.get(form.get('code'))
      const expected = entry && crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      if (!entry || expected !== entry.challenge) return send(400, { error: 'invalid_grant' })
      userId = entry.user
    } else if (form.get('grant_type') === 'refresh_token') {
      userId = fake.refresh.get(form.get('refresh_token'))
      if (!userId) return send(400, { error: 'invalid_grant' })
      fake.refresh.delete(form.get('refresh_token'))
    } else return send(400, { error: 'unsupported_grant_type' })
    const access = crypto.randomBytes(8).toString('hex')
    const refresh = crypto.randomBytes(8).toString('hex')
    fake.tokens.set(access, userId)
    fake.refresh.set(refresh, userId)
    return send(200, { access_token: access, refresh_token: refresh, expires_in: 604800, scope: 'identify guilds.members.read', token_type: 'Bearer' })
  }
  if (u.pathname === '/oauth2/token/revoke') { fake.tokens.delete(form.get('token')); return send(200, {}) }

  if (u.pathname === `/users/@me/guilds/${GUILD}/member`) {
    if (fake.rateLimited) return send(429, { message: 'rate limited', retry_after: 2.5 })
    const token = (req.headers.authorization || '').replace('Bearer ', '')
    if (fake.expireNext) { fake.expireNext = false; fake.tokens.delete(token) }
    const userId = fake.tokens.get(token)
    if (!userId) return send(401, { message: '401: Unauthorized', code: 0 })
    if (!fake.members.has(userId)) return send(404, { message: 'Unknown Guild', code: 10004 })
    return send(200, { user: { id: userId, username: 'jammer' + userId, global_name: 'Jammer' }, nick: null, roles: fake.roles[userId] || [] })
  }
  send(404, { message: 'not found' })
})

/** The "browser": Discord approves (or denies) and redirects back to JR. */
async function browser (url) {
  const u = new URL(url)
  fake.lastAuthorize = u
  const redirect = new URL(u.searchParams.get('redirect_uri'))
  if (!fake.approve) {
    redirect.searchParams.set('error', 'access_denied')
  } else {
    const code = crypto.randomBytes(6).toString('hex')
    fake.challenges.set(code, { challenge: u.searchParams.get('code_challenge'), user: fake.user })
    redirect.searchParams.set('code', code)
  }
  redirect.searchParams.set('state', u.searchParams.get('state'))
  setTimeout(() => http.get(redirect.toString(), (r) => r.resume()), 20)
}

function memoryStore () {
  let saved = null
  return { load: async () => saved, save: async (s) => { saved = JSON.parse(JSON.stringify(s)) }, clear: async () => { saved = null }, peek: () => saved }
}

api.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${api.address().port}`
  let clock = Date.now()
  let port = 54100
  const makeGate = (store, extra = {}) => new DiscordGate({
    clientId: 'jr-client', guildId: GUILD, apiBase: base, authorizeUrl: base + '/authorize',
    redirectUri: `http://127.0.0.1:${port++}/callback`, store, openExternal: browser, now: () => clock, recheckMs: 3600000, ...extra
  })

  try {
    console.log('Signing in:')
    const store = memoryStore()
    let gate = makeGate(store)
    const changes = []
    gate.on('change', (c) => changes.push(c.state))
    assert.strictEqual(await gate.start(), 'signed-out'); ok('starts signed out with nothing saved')
    assert.strictEqual(await gate.signIn(), 'member'); ok('member signs in and JR unlocks')
    assert.deepStrictEqual(changes, ['signing-in', 'checking', 'member']); ok('goes signing-in -> checking -> member')
    assert.strictEqual(fake.lastAuthorize.searchParams.get('code_challenge_method'), 'S256'); ok('uses PKCE, no client secret')
    assert.ok(fake.lastAuthorize.searchParams.get('scope').includes('guilds.members.read')); ok('asks only for identify + guilds.members.read')
    assert.strictEqual(gate.user.username, 'jammer42'); ok('knows who signed in')
    assert.ok(store.peek().accessToken && store.peek().refreshToken); ok('sign-in saved for next launch')
    gate.stop()

    console.log('Next launch:')
    gate = makeGate(store)
    assert.strictEqual(await gate.start(), 'member'); ok('saved sign-in is re-checked on launch, no browser needed')

    console.log('Leaving the server:')
    fake.members.delete('42')
    assert.strictEqual(await gate.check(), 'not-member'); ok('leaving locks JR on the next check')
    assert.strictEqual(gate.reason, 'not_in_server'); ok('reason says they are not in the server')
    clock += 60 * 1000
    fake.down = true
    assert.strictEqual(await gate.check(), 'offline'); ok('a non-member can’t use "Discord is down" to get back in')
    fake.down = false
    fake.members.add('42')
    assert.strictEqual(await gate.check(), 'member'); ok('rejoining unlocks again ("check again" button)')
    gate.stop()

    console.log('Banned / never joined:')
    fake.user = '77'
    const s2 = memoryStore()
    const g2 = makeGate(s2)
    assert.strictEqual(await g2.signIn(), 'not-member'); ok('non-member signs in but stays locked')
    g2.stop()
    fake.user = '42'

    console.log('Required role:')
    const g3 = makeGate(memoryStore(), { requiredRoleId: '555' })
    assert.strictEqual(await g3.signIn(), 'not-member'); ok('member without the required role stays locked')
    assert.strictEqual(g3.reason, 'missing_role'); ok('reason says the role is missing')
    fake.roles['42'].push('555')
    assert.strictEqual(await g3.check(), 'member'); ok('getting the role unlocks')
    g3.stop()

    console.log('Expired sign-in:')
    fake.expireNext = true
    assert.strictEqual(await gate.check(), 'member'); ok('expired access token is refreshed quietly')
    const store4 = memoryStore()
    const g4 = makeGate(store4)
    await g4.signIn()
    fake.refresh.clear()
    for (const k of [...fake.tokens.keys()]) fake.tokens.delete(k)
    assert.strictEqual(await g4.check(), 'signed-out'); ok('if the refresh is rejected, they sign in again')
    assert.strictEqual(store4.peek(), null); ok('dead sign-in is removed from disk')
    g4.stop()

    console.log('Discord unreachable:')
    const g5 = makeGate(memoryStore(), { graceMs: 15 * 60 * 1000 })
    await g5.signIn()
    fake.down = true
    clock += 5 * 60 * 1000
    assert.strictEqual(await g5.check(), 'member'); ok('short outage: a confirmed member keeps playing')
    clock += 20 * 60 * 1000
    assert.strictEqual(await g5.check(), 'offline'); ok('outage longer than the grace period locks JR')
    fake.down = false
    assert.strictEqual(await g5.check(), 'member'); ok('back online: unlocks after a fresh check')
    fake.rateLimited = true
    clock += 1000
    assert.strictEqual(await g5.check(), 'member'); ok('rate limit is treated like a short outage, not a lockout')
    fake.rateLimited = false
    g5.stop()

    console.log('Cancelled sign-in and sign-out:')
    fake.approve = false
    const g6 = makeGate(memoryStore())
    assert.strictEqual(await g6.signIn(), 'signed-out'); ok('pressing Cancel on Discord leaves JR signed out')
    assert.strictEqual(g6.reason, 'cancelled'); ok('reason says it was cancelled')
    fake.approve = true
    const store7 = memoryStore()
    const g7 = makeGate(store7)
    await g7.signIn()
    const token = store7.peek().accessToken
    await g7.signOut()
    assert.strictEqual(g7.state, 'signed-out'); ok('sign out locks JR')
    assert.ok(!fake.tokens.has(token)); ok('sign out tells Discord to revoke the token')

    console.log(`\n${passed} checks passed`)
  } catch (error) {
    console.error('\nFAILED:', error.stack || error.message)
    process.exitCode = 1
  } finally {
    api.close()
  }
})
