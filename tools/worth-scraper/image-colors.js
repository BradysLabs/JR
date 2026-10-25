'use strict'

/**
 * Finds the main colors of every picture in the Item Worth Wiki data, so JR
 * can match each game color of an item to the right wiki row by looking at
 * the pictures.
 *
 * Run from the JR folder (takes a few minutes, and can be stopped and
 * started again; it carries on where it left off):
 *
 *   npx electron tools/worth-scraper/image-colors.js
 *
 * Reads  data/worth/values.json
 * Writes data/worth/image-colors.json   { "<picture url>": [[r, g, b, share], ...] }
 */

const path = require('path')
const fs = require('fs')
const { app, BrowserWindow, net } = require('electron')

const ROOT = path.join(__dirname, '..', '..')
const INPUT = path.join(ROOT, 'data', 'worth', 'values.json')
const OUTPUT = path.join(ROOT, 'data', 'worth', 'image-colors.json')
const CONCURRENCY = 32
const SIZE = 40

app.disableHardwareAcceleration()

// Small version of a wiki picture (Fandom resizes on request).
function thumb (url) {
  const [base, query] = url.split('?')
  const scaled = /\/revision\/latest$/.test(base) ? `${base}/scale-to-width-down/${SIZE}` : base
  return query ? `${scaled}?${query}` : scaled
}

// Runs in a hidden window: decode a picture and list its main colors.
const PAGE = `<!doctype html><script>
async function palette (b64, type) {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], { type }))
  const w = Math.min(bitmap.width, 96), h = Math.max(1, Math.round(bitmap.height * w / bitmap.width))
  const canvas = new OffscreenCanvas(w, h)
  const g = canvas.getContext('2d')
  g.drawImage(bitmap, 0, 0, w, h)
  const d = g.getImageData(0, 0, w, h).data
  const bins = new Map()
  let total = 0
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2], a = d[i + 3]
    if (a < 128) continue // see-through background
    if (r > 242 && gg > 242 && b > 242) continue // white background
    const key = (r >> 3) << 10 | (gg >> 3) << 5 | (b >> 3)
    let bin = bins.get(key)
    if (!bin) { bin = [0, 0, 0, 0]; bins.set(key, bin) }
    bin[0] += r; bin[1] += gg; bin[2] += b; bin[3]++
    total++
  }
  if (!total) return []
  // Merge nearby bins into a handful of main colors.
  const sorted = [...bins.values()].sort((a, b) => b[3] - a[3])
  const out = []
  for (const [sr, sg, sb, n] of sorted) {
    const c = [sr / n, sg / n, sb / n]
    const near = out.find(o => Math.abs(o[0] - c[0]) + Math.abs(o[1] - c[1]) + Math.abs(o[2] - c[2]) < 36)
    if (near) {
      const t = near[4] + n
      near[0] = (near[0] * near[4] + c[0] * n) / t; near[1] = (near[1] * near[4] + c[1] * n) / t; near[2] = (near[2] * near[4] + c[2] * n) / t; near[4] = t
    } else if (out.length < 8) out.push([c[0], c[1], c[2], 0, n])
  }
  return out.map(o => [Math.round(o[0]), Math.round(o[1]), Math.round(o[2]), Math.round(o[4] / total * 1000) / 1000]).filter(o => o[3] >= 0.02)
}
</script>`

async function main () {
  const data = JSON.parse(fs.readFileSync(INPUT, 'utf8'))
  // Only pages where the versions have different values and different
  // pictures need the colors; everything else is matched without them.
  const byPage = new Map()
  for (const row of data.items || []) {
    if (!byPage.has(row.page)) byPage.set(row.page, [])
    byPage.get(row.page).push(row)
  }
  const wanted = new Set()
  for (const rows of byPage.values()) {
    if (rows.length < 2) continue
    if (new Set(rows.map(r => String(r.raw || '').trim())).size < 2) continue
    if (new Set(rows.map(r => r.image).filter(Boolean)).size < 2) continue
    for (const r of rows) if (r.image) wanted.add(r.image)
  }
  const urls = [...wanted].filter(u => /^https:\/\/static\.wikia\.nocookie\.net\//.test(u))
  let done = {}
  try { done = JSON.parse(fs.readFileSync(OUTPUT, 'utf8')) } catch (_) {}
  const todo = urls.filter(u => !(u in done))
  console.log(`${urls.length} wiki pictures, ${urls.length - todo.length} already done, ${todo.length} to go.`)

  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE))

  let finished = 0
  let failed = 0
  let lastSave = Date.now()
  const started = Date.now()
  const save = () => fs.writeFileSync(OUTPUT, JSON.stringify(done))

  async function one (url) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await net.fetch(thumb(url), { headers: { 'User-Agent': 'JRWorthCollector (BradysLabs JR)' } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const type = res.headers.get('content-type') || 'image/png'
        const b64 = Buffer.from(await res.arrayBuffer()).toString('base64')
        done[url] = await win.webContents.executeJavaScript(`palette(${JSON.stringify(b64)}, ${JSON.stringify(type)})`)
        return
      } catch (error) {
        if (attempt === 2) { done[url] = null; failed++ }
        else await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
  }

  let next = 0
  async function worker () {
    while (next < todo.length) {
      const url = todo[next++]
      await one(url)
      finished++
      if (finished % 250 === 0 || finished === todo.length) {
        const secs = (Date.now() - started) / 1000
        const left = Math.round((todo.length - finished) / (finished / secs) / 60)
        console.log(`  ${finished} / ${todo.length}${failed ? ` (${failed} couldn't be read)` : ''} · about ${left} min left`)
      }
      if (Date.now() - lastSave > 15000) { save(); lastSave = Date.now() }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  save()
  const ok = Object.values(done).filter(v => v && v.length).length
  console.log(`Done. ${ok} pictures have colors. Saved to data/worth/image-colors.json`)
  app.quit()
}

app.whenReady().then(main).catch((error) => { console.error(error); app.exit(1) })
