/**
 * Discord sign-in for a desktop app, using the authorization code flow with
 * PKCE so JR never ships a client secret ("Public Client" must be turned on
 * for the app in the Discord Developer Portal).
 *
 * The user signs in in their normal web browser (where they're usually
 * already logged into Discord). Discord sends them back to a tiny server
 * JR runs on 127.0.0.1 just long enough to receive the code.
 */
const crypto = require('crypto')
const http = require('http')

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A fresh PKCE verifier + challenge pair. */
function pkce () {
  const verifier = b64url(crypto.randomBytes(48))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/**
 * Builds the Discord authorize URL.
 * @param {{authorizeUrl:string, clientId:string, redirectUri:string, scopes:string[], state:string, challenge:string}} o
 */
function authorizeUrl (o) {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    scope: o.scopes.join(' '),
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: 'S256'
  })
  // When signing in again, skip the consent screen they already accepted.
  if (o.silent) q.set('prompt', 'none')
  return `${o.authorizeUrl}?${q}`
}

/**
 * Waits for Discord to redirect back to http://127.0.0.1:<port><path>.
 * Resolves with the code, rejects on error, wrong state, or timeout.
 */
function waitForCallback ({ redirectUri, state, timeoutMs = 5 * 60 * 1000, page }) {
  const url = new URL(redirectUri)
  return new Promise((resolve, reject) => {
    const done = (fn, value, html) => (res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      clearTimeout(timer)
      server.close()
      fn(value)
    }
    const server = http.createServer((req, res) => {
      const got = new URL(req.url, url.origin)
      if (got.pathname !== url.pathname) { res.writeHead(404); res.end(); return }
      const error = got.searchParams.get('error')
      if (error) return done(reject, Object.assign(new Error(got.searchParams.get('error_description') || error), { code: error }), page('Sign-in was cancelled. You can close this tab and try again in JR.'))(res)
      if (got.searchParams.get('state') !== state) return done(reject, Object.assign(new Error('State mismatch'), { code: 'state_mismatch' }), page('Something went wrong. Please try again from JR.'))(res)
      const code = got.searchParams.get('code')
      if (!code) return done(reject, Object.assign(new Error('No code returned'), { code: 'no_code' }), page('Something went wrong. Please try again from JR.'))(res)
      done(resolve, code, page('You’re signed in. You can close this tab and go back to JR.'))(res)
    })
    const timer = setTimeout(() => { server.close(); reject(Object.assign(new Error('Sign-in timed out'), { code: 'timeout' })) }, timeoutMs)
    server.on('error', (e) => { clearTimeout(timer); reject(Object.assign(e, { code: e.code === 'EADDRINUSE' ? 'port_in_use' : e.code })) })
    server.listen(Number(url.port), url.hostname)
  })
}

const simplePage = (msg) => `<!doctype html><meta charset="utf-8"><title>JR</title><body style="margin:0;background:#0b0b0c;color:#ededee;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><div style="width:56px;height:56px;border-radius:14px;background:#ededee;color:#0b0b0c;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:20px">JR</div><p style="font-size:18px;margin-top:20px">${msg}</p></div></body>`

/** POSTs to Discord's token endpoint (form encoded, no client secret). */
async function tokenRequest (fetchImpl, tokenUrl, form) {
  const res = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.error_description || body.error || `HTTP ${res.status}`), { code: body.error || `http_${res.status}`, status: res.status })
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    expiresAt: Date.now() + (Number(body.expires_in) || 0) * 1000,
    scope: body.scope
  }
}

module.exports = { pkce, authorizeUrl, waitForCallback, tokenRequest, simplePage }
