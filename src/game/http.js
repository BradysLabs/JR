'use strict'

/**
 * Small HTTP client on Node's http/https modules.
 *
 * JR's engine runs inside a window, where `fetch` is the browser's: it can't
 * be passed around loosely and it applies web page security rules to Animal
 * Jam's servers. This uses Node directly instead, with a fetch-like result.
 */

const http = require('http')
const https = require('https')
const zlib = require('zlib')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 JR/0.0.0'

/**
 * @param {string} url
 * @param {{method?: string, headers?: object, body?: Buffer|string, redirects?: number, timeout?: number}} [options]
 * @returns {Promise<{ok: boolean, status: number, headers: object, stream: import('stream').Readable, buffer: () => Promise<Buffer>, text: () => Promise<string>, json: () => Promise<any>, arrayBuffer: () => Promise<ArrayBuffer>}>}
 */
function request (url, { method = 'GET', headers = {}, body, redirects = 5, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null
    if (!lib) return reject(new Error(`Unsupported address ${url}`))
    const h = { 'user-agent': UA, 'accept-encoding': 'gzip, deflate', ...lowerKeys(headers) }
    if (body != null) h['content-length'] = Buffer.byteLength(body)
    const req = lib.request(u, { method, headers: h, timeout }, (res) => {
      const status = res.statusCode
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirects > 0) {
        res.resume()
        const next = new URL(res.headers.location, u).toString()
        const keepBody = status === 307 || status === 308
        return resolve(request(next, { method: keepBody ? method : 'GET', headers, body: keepBody ? body : undefined, redirects: redirects - 1, timeout }))
      }
      let stream = res
      const enc = String(res.headers['content-encoding'] || '').toLowerCase()
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip())
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate())
      const responseHeaders = { ...res.headers }
      if (enc === 'gzip' || enc === 'deflate') { delete responseHeaders['content-encoding']; delete responseHeaders['content-length'] }
      let cached = null
      const buffer = () => {
        if (!cached) {
          cached = new Promise((resolve2, reject2) => {
            const chunks = []
            stream.on('data', c => chunks.push(c))
            stream.on('end', () => resolve2(Buffer.concat(chunks)))
            stream.on('error', reject2)
          })
        }
        return cached
      }
      resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: responseHeaders,
        stream,
        buffer,
        text: async () => (await buffer()).toString('utf8'),
        json: async () => JSON.parse((await buffer()).toString('utf8')),
        arrayBuffer: async () => { const b = await buffer(); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }
      })
    })
    req.on('timeout', () => req.destroy(new Error(`Timed out loading ${u.host}`)))
    req.on('error', reject)
    if (body != null) req.write(body)
    req.end()
  })
}

function lowerKeys (o) {
  const out = {}
  for (const [k, v] of Object.entries(o || {})) if (v !== undefined) out[k.toLowerCase()] = v
  return out
}

module.exports = { request }
