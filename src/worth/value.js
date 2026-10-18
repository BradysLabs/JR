'use strict'

/**
 * Reads Item Worth Wiki value text into amounts JR can add up.
 *
 * The wiki writes values as alternatives separated by "/" (each one is the
 * same worth in a different currency), for example
 *   "2 Good Short Collars / 140-170 Diamonds"
 *   "1 Bad Long Collar + 1 Black Long Wrist"
 *   "Decent - Good Short Collar"
 *   "12-13 Black Long Collars"
 * A side is a sum of parts; each part is a count (or count range) of a unit.
 */

const GRADES = ['bad', 'decent', 'good', 'great', 'red', 'black']

/** Normalizes a unit name: "Black Long Collars" -> "black long collar". */
function unitKey (text) {
  let u = String(text || '').toLowerCase().trim()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ').trim()
  u = u.replace(/^a few /, '').replace(/^few /, '')
  u = u.replace(/\bwrists\b/g, 'wrist').replace(/\bcollars\b/g, 'collar').replace(/\brims\b/g, 'rim').replace(/\bbetas\b/g, 'beta').replace(/\bdiamond$/, 'diamonds')
  u = u.replace(/\brare item mondays?\b/, 'rim')
  if (/^(den beta|den betas)$/.test(u)) return 'den beta'
  if (/^clothing betas?$/.test(u)) return 'clothing beta'
  if (/^variet(y|ies)$/.test(u)) return 'variety'
  if (/^bl$|^black long$/.test(u)) return 'black long collar'
  return u
}

/** One part like "2 Good Short Collars", "12-13 Black Long Collars", "A Few RIMs". */
function parsePart (text) {
  const t = text.trim().replace(/,?\s*maybe (more|less)\b/ig, '').trim()
  if (!t) return null
  let m = /^(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s+(.+)$/i.exec(t)
  if (m) return { min: Number(m[1]), max: Number(m[2]), unit: unitKey(m[3]) }
  m = /^(\d+(?:\.\d+)?)\+?\s+(.+)$/i.exec(t)
  if (m) return { min: Number(m[1]), max: Number(m[1]), unit: unitKey(m[2]) }
  m = /^(a few|few)\s+(.+)$/i.exec(t)
  if (m) return { min: 2, max: 4, unit: unitKey(m[2]) }
  // Grade ranges: "Decent - Good Short Collar", "Black Short Collar - Bad Long Collar"
  const sides = t.split(/\s+-\s+/)
  if (sides.length === 2) {
    const a = ladderOf(sides[0])
    const b = ladderOf(sides[1])
    if (a && b) {
      const fill = (x, y) => ({ grade: x.grade || y.grade, size: x.size || y.size, kind: x.kind || y.kind })
      const lo = fill(a, b)
      const hi = fill(b, a)
      if (lo.size && lo.kind && hi.size && hi.kind) return { min: 1, max: 1, unit: ladderKey(lo), upTo: ladderKey(hi) }
    }
  }
  const l = ladderOf(t)
  if (l && l.grade && l.size && l.kind) return { min: 1, max: 1, unit: ladderKey(l) }
  // A bare unit: "Den Beta", "Black Long Collar"
  const u = unitKey(t)
  if (KNOWN_UNITS.has(u) || /^(bad|decent|good|great|red|black) (long|short) (collar|wrist)$/.test(u)) return { min: 1, max: 1, unit: u }
  return null
}

const KNOWN_UNITS = new Set(['diamonds', 'black long collar', 'variety', 'rim', 'den beta', 'clothing beta', 'gems'])

function ladderOf (text) {
  const w = String(text).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
  if (!w.length || w.length > 4) return null
  const out = {}
  for (const word of w) {
    if (GRADES.includes(word)) out.grade = word
    else if (word === 'long' || word === 'short') out.size = word
    else if (/^collars?$/.test(word)) out.kind = 'collar'
    else if (/^wrists?$/.test(word) || /^wristbands?$/.test(word)) out.kind = 'wrist'
    else return null
  }
  return out.grade || out.size || out.kind ? out : null
}

function ladderKey ({ grade, size, kind }) { return `${grade} ${size} ${kind}` }

/** "1 Bad Long Collar + 1 Black Long Wrist" -> [part, part] (or null if any part is unreadable). */
function parseSide (text) {
  const parts = String(text).split(/\s*\+\s*|\s+and\s+/i).map(parsePart)
  if (!parts.length || parts.some(p => !p)) return null
  return parts
}

/**
 * Reads a whole wiki value ("A / B / C").
 * @returns {{alternatives: object[][], status: string|null}}
 */
function parseValue (text) {
  const t = String(text || '')
  const status = /currently in stores/i.test(t) ? 'store'
    : /under investigation|hard to value/i.test(t) ? 'unknown'
      : /in existence/i.test(t) ? 'rare'
        : null
  const alternatives = []
  for (const side of t.split(/\s*\/\s*|\n/)) {
    const parts = parseSide(side.replace(/\(.*?\)/g, '').trim())
    if (parts) alternatives.push(parts)
  }
  return { alternatives, status }
}

/**
 * Works out how many Diamonds each unit is worth, from wiki entries that give
 * the same value in Diamonds and in another unit side by side.
 * @param {string[]} texts wiki value texts
 * @returns {Map<string, number>} unit -> diamonds (median of what the wiki says)
 */
function deriveRates (texts) {
  const samples = new Map()
  const add = (unit, d) => { if (d > 0 && isFinite(d)) { if (!samples.has(unit)) samples.set(unit, []); samples.get(unit).push(d) } }
  const mid = (p) => (p.min + p.max) / 2
  for (const text of texts) {
    const { alternatives } = parseValue(text)
    const dia = alternatives.find(a => a.length === 1 && a[0].unit === 'diamonds')
    if (!dia) continue
    const d = mid(dia[0])
    for (const alt of alternatives) {
      if (alt === dia || alt.length !== 1 || alt[0].unit === 'diamonds' || alt[0].upTo) continue
      add(alt[0].unit, d / mid(alt[0]))
    }
  }
  const rates = new Map([['diamonds', 1]])
  for (const [unit, list] of samples) {
    if (list.length < 3) continue
    list.sort((a, b) => a - b)
    rates.set(unit, list[Math.floor(list.length / 2)])
  }
  return { rates, samples }
}

/**
 * Value of a wiki text in Diamonds, as a range.
 * Uses the first alternative whose units all have a rate.
 * @returns {{min: number, max: number, via: string}|null}
 */
function inDiamonds (text, rates) {
  const { alternatives } = parseValue(text)
  const sorted = [...alternatives].sort((a, b) => (b[0].unit === 'diamonds') - (a[0].unit === 'diamonds'))
  for (const alt of sorted) {
    let min = 0
    let max = 0
    let ok = true
    for (const p of alt) {
      const r = rates.get(p.unit)
      if (!r) { ok = false; break }
      const hi = p.upTo ? rates.get(p.upTo) || r : r
      min += p.min * Math.min(r, hi)
      max += p.max * Math.max(r, hi)
    }
    if (ok) return { min, max, via: alt.map(p => p.unit).join(' + ') }
  }
  return null
}

/**
 * The trading ladder (Bad/Decent/Good/Black × Short/Long × Wrist/Collar) is
 * defined on the wiki's four "Rare Spiked" pages, which grade each color and
 * give it a Diamond value. Each grade's worth is the average of its colors.
 * @param {{p: string, v: string|null, g: string|null, t: string}[]} entries
 * @returns {Map<string, number>} e.g. "good short collar" -> 103
 */
function deriveLadder (entries) {
  const PAGES = {
    'rare long spiked collar': ['long', 'collar'],
    'rare short spiked collar': ['short', 'collar'],
    'rare long spiked wristband': ['long', 'wrist'],
    'rare short spiked wristband': ['short', 'wrist']
  }
  const sums = new Map()
  const out = new Map()
  for (const e of entries) {
    const where = PAGES[String(e.p).toLowerCase()]
    if (!where) continue
    const { alternatives } = parseValue(e.t)
    const dia = alternatives.find(a => a.length === 1 && a[0].unit === 'diamonds')
    if (!dia) continue
    const d = (dia[0].min + dia[0].max) / 2
    const [size, kind] = where
    if (e.g) {
      const grade = String(e.g).toLowerCase() === 'best' ? 'black' : String(e.g).toLowerCase()
      const key = `${grade} ${size} ${kind}`
      const cur = sums.get(key) || [0, 0]
      sums.set(key, [cur[0] + d, cur[1] + 1])
      // A named color is its own unit too ("Red Long Collar").
      if (e.v) out.set(`${String(e.v).toLowerCase()} ${size} ${kind}`, d)
    } else if (size === 'long' && kind === 'collar' && !e.v) {
      // The page's own line for the Black Long Collar (the main unit).
      out.set('black long collar*', d)
    }
  }
  for (const [key, [total, n]] of sums) out.set(key, total / n)
  if (out.has('black long collar*')) {
    out.set('black long collar', out.get('black long collar*'))
    out.delete('black long collar*')
  }
  // Variety headdresses trade one for one with Black Long Collars on the wiki.
  if (out.has('black long collar') && !out.has('variety')) out.set('variety', out.get('black long collar'))
  return out
}

/** All rates in Diamonds: the ladder plus rates seen side by side on the wiki. */
function buildRates (entries, overrides = {}) {
  const { rates } = deriveRates(entries.map(e => e.t))
  rates.delete('gems')
  for (const [k, v] of deriveLadder(entries)) rates.set(k, v)
  for (const [k, v] of Object.entries(overrides || {})) if (Number(v) > 0) rates.set(unitKey(k), Number(v))
  return rates
}

module.exports = { parseValue, parsePart, unitKey, deriveRates, deriveLadder, buildRates, inDiamonds, ladderOf }
