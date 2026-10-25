'use strict'

/**
 * Matches an item's game colors to the right wiki rows by comparing the
 * game's real palette colors with the main colors of each wiki picture
 * (data/worth/image-colors.json, made by tools/worth-scraper/image-colors.js).
 *
 * Every color of the item is matched at once (each wiki row used at most
 * once), and a match is only kept when it is clearly better than the
 * alternatives, so a doubtful picture never puts a value on an item.
 */

const rgbOf = (v) => (Array.isArray(v) ? v : [(v >>> 16) & 255, (v >>> 8) & 255, v & 255])

function lab (c) {
  const [r, g, b] = rgbOf(c).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047)
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722)
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Cheapest one-to-one assignment (rows x cols, rows <= cols). */
function assign (cost) {
  const n = cost.length
  const m = cost[0].length
  const u = new Array(n + 1).fill(0)
  const v = new Array(m + 1).fill(0)
  const p = new Array(m + 1).fill(0)
  const way = new Array(m + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array(m + 1).fill(Infinity)
    const used = new Array(m + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = Infinity
      let j1 = 0
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0 }
        if (minv[j] < delta) { delta = minv[j]; j1 = j }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta } else minv[j] -= delta
      }
      j0 = j1
    } while (p[j0] !== 0)
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1 } while (j0)
  }
  const out = new Array(n).fill(-1)
  for (let j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1
  return out
}

function createPictureMatcher (colorsByUrl, { maxDistance = 14, margin = 1.6 } = {}) {
  const palettes = new Map()
  const paletteOf = (url) => {
    if (!url || !colorsByUrl[url]) return null
    if (!palettes.has(url)) palettes.set(url, colorsByUrl[url].map(([r, g, b, share]) => ({ lab: lab([r, g, b]), share })))
    return palettes.get(url)
  }

  /**
   * gameColors: [{ key, layers: [rgb, rgb, rgb, rgb] }] for every color of one item.
   * rows: the item's wiki rows that name a color, each with an image.
   * Returns Map(key -> row) for the colors that were matched with confidence.
   */
  function matchGroup (gameColors, usable) {
    const result = new Map()
    if (gameColors.length < 1 || usable.length < 2) return { result, score: Infinity }
    // Only the layers that change between colors tell the versions apart.
    const layerCount = Math.min(...gameColors.map(c => c.layers.length))
    let varied = []
    for (let l = 0; l < layerCount; l++) {
      if (new Set(gameColors.map(c => c.layers[l])).size > 1) varied.push(l)
    }
    if (!varied.length) varied = [0]
    // Picture colors every row shares (the item's fixed parts) don't help.
    const pals = usable.map(r => paletteOf(r.image))
    const common = pals.map((pal, i) => pal.map(c => {
      let n = 0
      pals.forEach((other, j) => { if (j !== i && other.some(o => dist(o.lab, c.lab) < 8)) n++ })
      return n >= Math.max(2, (pals.length - 1) * 0.7)
    }))
    const distinct = pals.map((pal, i) => {
      const own = pal.filter((_, k) => !common[i][k])
      return own.length ? own : pal
    })
    // White can't be measured: the picture tool drops white pixels as background.
    const white = (v) => lab(v)[0] > 88 && Math.hypot(lab(v)[1], lab(v)[2]) < 18
    const cost = gameColors.map(c => {
      const want = varied.filter(l => !white(c.layers[l])).map(l => lab(c.layers[l]))
      if (!want.length) return distinct.map(() => 999)
      return distinct.map(pal => want.reduce((s, w) => s + Math.min(...pal.map(o => dist(o.lab, w))), 0) / want.length)
    })
    // Hungarian needs rows <= cols; transpose when there are more colors than rows.
    let pick
    if (gameColors.length <= usable.length) pick = assign(cost)
    else {
      const t = usable.map((_, j) => gameColors.map((_, i) => cost[i][j]))
      const back = assign(t)
      pick = new Array(gameColors.length).fill(-1)
      back.forEach((i, j) => { if (i >= 0) pick[i] = j })
    }
    gameColors.forEach((c, i) => {
      const j = pick[i]
      if (j < 0) return
      const mine = cost[i][j]
      if (mine > maxDistance) return
      // The chosen picture must be clearly closer than any other picture for
      // this color, and no other color may be just as close to it.
      const otherRow = Math.min(...cost[i].filter((_, k) => k !== j && String(usable[k].raw) !== String(usable[j].raw)))
      const otherColor = Math.min(...cost.map((r, k) => (k !== i ? r[j] : Infinity)))
      if (Number.isFinite(otherRow) && otherRow < mine * margin + 2) return
      if (Number.isFinite(otherColor) && otherColor < mine * 1.15 + 1) return
      result.set(c.key, { ...usable[j], _pictureCost: Math.round(mine * 10) / 10 })
    })
    // How well this set of pictures fits the item's colors overall.
    const fits = gameColors.map((c, i) => (pick[i] >= 0 && cost[i][pick[i]] < 999 ? Math.min(cost[i][pick[i]], 40) : null)).filter(v => v != null)
    return { result, score: fits.length ? fits.reduce((a, b) => a + b, 0) / fits.length : Infinity }
  }

  function match (gameColors, rows) {
    const usable = rows.filter(r => paletteOf(r.image))
    // Two game items can share a name (a store Eye Patch and a Rare Item
    // Monday one). Each wiki section is one item, so try them one at a time
    // and use the section that fits this item's colors clearly best.
    const groups = new Map()
    for (const r of usable) {
      const key = `${r.page}|${r.section || ''}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(r)
    }
    const all = matchGroup(gameColors, usable)
    if (groups.size < 2) return all.result
    const tries = [...groups.values()].filter(g => g.length >= 2).map(g => matchGroup(gameColors, g)).sort((a, b) => a.score - b.score)
    if (tries.length && Number.isFinite(tries[0].score) && (tries.length === 1 || tries[0].score * 1.5 < tries[1].score)) return tries[0].result
    return all.result
  }

  return { match, lab, dist }
}

module.exports = { createPictureMatcher, assign }
