'use strict'

/**
 * Short worth labels for item names, for showing worth inside Animal Jam
 * itself: "Worn Blanket" -> "Worn Blanket · A Few RIMs",
 * "Rare Spiked Wristband" -> "Rare Spiked Wristband · 2.5k-40k Diamonds by color".
 *
 * Every item the wiki has an exact page or row for gets a label:
 *   - one clear value that fits: the wiki's own words
 *   - values that differ by color, or one too long to fit: the range in
 *     Diamonds across all its wiki rows, using the wiki's own exchange rates
 *   - one value too long to fit and not convertible: that value, shortened with "…"
 *   - neither: "varies by color"
 * Fuzzy name matches never get a label, so the game never shows a guess.
 */

const match = require('./match')
const value = require('./value')

const MAX_VALUE = 28 // characters; longer values don't fit the game's name boxes
const MAX_NAME = 40
const SEPARATOR = ' · '

/** The first alternative of a wiki value, if it's short enough. */
function shortValue (text) {
  const first = String(text || '').split(SEPARATOR)[0].replace(/\s+/g, ' ').trim()
  return first && first.length <= MAX_VALUE ? first : null
}

/** 85 -> "85", 1240 -> "1.2k", 40000 -> "40k". */
function compact (n) {
  if (n >= 10000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(Math.round(n / 100) / 10).toString().replace(/\.0$/, '')}k`
  if (n >= 100) return String(Math.round(n / 5) * 5)
  return String(Math.round(n))
}

/** {min, max} Diamonds -> "120-450 Diamonds" (plus " by color" when it fits and helps). */
function diamondLabel ({ min, max }, byColor) {
  const a = compact(min)
  const b = compact(max)
  const range = a === b ? `${a} Diamonds` : `${a}-${b} Diamonds`
  return byColor && a !== b && (range + ' by color').length <= MAX_VALUE ? range + ' by color' : range
}

/**
 * @param {object[]} items rows from data/worth/values.json
 * @returns {{label: (name: string, names?: Set<string>) => (string|null), index: Map}}
 *   label(name, names): the labeled name, or null for no label. When `names`
 *   is given (normalized item names from the game's item packs), only those
 *   names are labeled, so other game text is never touched.
 */
function createLabeler (items) {
  const index = match.indexWorth(items)
  const rates = value.buildRates((items || []).map(it => ({ p: it.page, v: it.variant, g: it.grade, t: it.raw })))
  const cache = new Map()

  const valueFor = (name) => {
    // One clear value for the item itself.
    const single = match.valueForRows(match.rowsForInventory(index, name, null), null)
    const text = shortValue(single)
    if (text) return text
    // Otherwise every exact wiki row for this name (all its colors).
    const rows = match.rowsFor(index, name, null).filter(row => !row._wikiNameCandidate)
    if (!rows.length) return null
    const ranges = rows.map(row => value.inDiamonds(row.raw || '', rates)).filter(Boolean)
    if (ranges.length) {
      const min = Math.min(...ranges.map(r => r.min))
      const max = Math.max(...ranges.map(r => r.max))
      return diamondLabel({ min, max }, !single)
    }
    if (!single) return 'varies by color'
    // One value, too long to fit and not in Diamonds: shorten it.
    const first = String(single).split(SEPARATOR)[0].replace(/\s+/g, ' ').trim()
    return first.slice(0, MAX_VALUE - 1).trimEnd() + '\u2026'
  }

  const label = (name, names) => {
    if (typeof name !== 'string') return null
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > MAX_NAME || /[\r\n]/.test(name) || name.includes(SEPARATOR)) return null
    if (names && !names.has(match.normalize(trimmed))) return null
    if (!cache.has(trimmed)) cache.set(trimmed, valueFor(trimmed))
    const v = cache.get(trimmed)
    return v ? `${name}${SEPARATOR}${v}` : null
  }
  return { label, index }
}

/** Normalized names of every clothing and den item in an ItemDatabase. */
function itemNames (db) {
  const names = new Set()
  for (const map of [db && db.clothing, db && db.den]) {
    if (!(map instanceof Map)) continue
    for (const item of map.values()) if (item && item.name) names.add(match.normalize(item.name))
  }
  names.delete('')
  return names
}

module.exports = { createLabeler, itemNames, shortValue, compact, SEPARATOR, MAX_VALUE }
