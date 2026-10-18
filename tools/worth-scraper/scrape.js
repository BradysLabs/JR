#!/usr/bin/env node
/**
 * JR worth collector (BradysLabs).
 *
 * Reads every page of the Animal Jam Item Worth Wiki through its official
 * MediaWiki API and writes values.json: one entry per item (and per color
 * column), with its picture, grade and trade values.
 *
 * Polite by design: one request at a time with a delay, identifies itself,
 * backs off when the wiki is busy, and caches pages so later runs only fetch
 * pages that were edited since.
 *
 * Usage:
 *   node scrape.js                      full run -> values.json + report.json
 *   node scrape.js --only "Headdress|Alpha Set"
 *   node scrape.js --limit 25           first 25 pages (quick test)
 *   node scrape.js --offline            rebuild from the cache, no network
 * Options: --delay 1500  --out values.json  --cache .cache  --base https://aj-item-worth.fandom.com
 *
 * Wiki content is CC BY-SA; values.json keeps the source page for every item.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { readPage } = require('./lib/tables')

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf('--' + name)
  if (i === -1) return def
  const v = args[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}
const BASE = String(opt('base', 'https://aj-item-worth.fandom.com')).replace(/\/$/, '')
const API = BASE + '/api.php'
const DELAY = Number(opt('delay', 1500))
const LIMIT = Number(opt('limit', 0)) || Infinity
const ONLY = opt('only', null)
const OFFLINE = !!opt('offline', false)
const OUT = path.resolve(opt('out', 'values.json'))
const CACHE = path.resolve(opt('cache', '.cache'))
const USER_AGENT = 'JRWorthCollector/1.0 (+https://github.com/BradysLabs/JR; weekly, rate-limited)'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

let lastRequest = 0
async function api (params, attempt = 1) {
  const wait = lastRequest + DELAY - Date.now()
  if (wait > 0) await sleep(wait)
  lastRequest = Date.now()
  const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params })
  let res
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT } })
  } catch (error) {
    if (attempt >= 5) throw error
    await sleep(2000 * attempt)
    return api(params, attempt + 1)
  }
  const retryAfter = Number(res.headers.get('retry-after')) || 0
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`HTTP ${res.status} for ${params.action}`)
    await sleep(Math.max(retryAfter * 1000, 5000 * attempt))
    return api(params, attempt + 1)
  }
  const body = await res.json()
  if (body.error) {
    if (body.error.code === 'maxlag' && attempt < 8) {
      await sleep(Math.max(retryAfter * 1000, 5000))
      return api(params, attempt + 1)
    }
    throw new Error(`${body.error.code}: ${body.error.info}`)
  }
  return body
}

/** Every normal content page title (no redirects). */
async function listPages () {
  const titles = []
  let cont = {}
  do {
    const body = await api({ action: 'query', list: 'allpages', apnamespace: '0', apfilterredir: 'nonredirects', aplimit: '500', ...cont })
    for (const p of body.query.allpages) titles.push(p.title)
    cont = body.continue || null
    log(`listed ${titles.length} pages`)
  } while (cont)
  return titles
}

/** Latest revision id + time for up to 50 titles per request. */
async function revisions (titles) {
  const out = new Map()
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50)
    const body = await api({ action: 'query', prop: 'revisions', rvprop: 'ids|timestamp', titles: batch.join('|') })
    for (const p of body.query.pages || []) {
      if (p.revisions && p.revisions[0]) out.set(p.title, { revid: p.revisions[0].revid, editedAt: p.revisions[0].timestamp })
    }
  }
  return out
}

const cacheFile = (title) => path.join(CACHE, 'pages', crypto.createHash('sha1').update(title).digest('hex') + '.json')
const readCache = (title) => { try { return JSON.parse(fs.readFileSync(cacheFile(title), 'utf8')) } catch (_) { return null } }
const writeCache = (entry) => {
  fs.mkdirSync(path.dirname(cacheFile(entry.title)), { recursive: true })
  fs.writeFileSync(cacheFile(entry.title), JSON.stringify(entry))
}

async function fetchPage (title, rev) {
  const cached = readCache(title)
  if (cached && (OFFLINE || (rev && cached.revid === rev.revid))) return { ...cached, fromCache: true }
  if (OFFLINE) return null
  const body = await api({ action: 'parse', page: title, prop: 'text|revid', disablelimitreport: '1', disableeditsection: '1', redirects: '1' })
  const entry = { title, revid: body.parse.revid, editedAt: rev ? rev.editedAt : null, html: body.parse.text }
  writeCache(entry)
  return entry
}

function cachedTitles () {
  const dir = path.join(CACHE, 'pages')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).title } catch (_) { return null } }).filter(Boolean)
}

async function main () {
  const started = Date.now()
  let titles = ONLY ? String(ONLY).split('|').map((s) => s.trim()).filter(Boolean)
    : OFFLINE ? cachedTitles() : await listPages()
  titles = titles.slice(0, LIMIT)
  log(`${titles.length} pages to read${OFFLINE ? ' (offline, from cache)' : ''}`)

  const revs = OFFLINE ? new Map() : await revisions(titles)
  const items = []
  const report = { pagesRead: 0, pagesWithItems: 0, fromCache: 0, failed: [], noTables: [], textOnly: [], warnings: {} }

  for (const [i, title] of titles.entries()) {
    try {
      const page = await fetchPage(title, revs.get(title))
      if (!page) continue
      report.pagesRead++
      if (page.fromCache) report.fromCache++
      const url = BASE + '/wiki/' + encodeURIComponent(title.replace(/ /g, '_'))
      const result = readPage(page.html, { title, url, editedAt: page.editedAt })
      if (result.items.length) report.pagesWithItems++
      else report.noTables.push(title)
      if (result.warnings.length) report.warnings[title] = result.warnings
      for (const it of result.items) {
        if (!it.offers.some((o) => o.min != null || o.bundle)) report.textOnly.push(it.id)
      }
      items.push(...result.items)
      if ((i + 1) % 25 === 0 || i === titles.length - 1) log(`${i + 1}/${titles.length} pages · ${items.length} items so far`)
    } catch (error) {
      report.failed.push({ title, error: error.message })
      log(`failed: ${title}: ${error.message}`)
    }
  }

  const units = {}
  for (const it of items) {
    for (const o of it.offers) {
      for (const piece of o.bundle || [o]) if (piece.unit) units[piece.unit] = (units[piece.unit] || 0) + 1
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: BASE,
    attribution: 'Values and pictures from the Animal Jam Item Worth Wiki (aj-item-worth.fandom.com), CC BY-SA. Each item links to its source page.',
    itemCount: items.length,
    units: Object.entries(units).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    items
  }
  fs.writeFileSync(OUT, JSON.stringify(output, null, 1))
  report.items = items.length
  report.seconds = Math.round((Date.now() - started) / 1000)
  fs.writeFileSync(OUT.replace(/\.json$/, '') + '.report.json', JSON.stringify(report, null, 2))
  log(`done: ${items.length} items from ${report.pagesWithItems} pages -> ${path.basename(OUT)} (${report.failed.length} failed, ${report.noTables.length} pages without tables)`)
  if (report.failed.length && report.pagesRead === 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
