'use strict'

/**
 * What JR's hover bubble shows for one item in one color: its worth in
 * Diamonds and in Black Long collars, the wiki's own trade values, a picture,
 * and how sure the match is.
 *
 * Matching is the same as JR's Trading page: the game's item definition and
 * its packed color pick the exact wiki row where the wiki has one. When the
 * wiki has no row for that color, every row for the item is shown and the
 * bubble says it's the range across all colors.
 */

const match = require('./match')
const value = require('./value')
const { SEPARATOR } = require('./labels')

const MAX_LINES = 6

/**
 * @param {{worthItems: object[], db: object}} options worthItems: rows from
 *   data/worth/values.json; db: an ItemDatabase (clothing/den names, colors)
 * @returns {(q: {defId: any, color: any, name?: string}) => object}
 */
function createWorthLookup ({ worthItems, db }) {
  const index = match.indexWorth(worthItems || [])
  const rates = value.buildRates((worthItems || []).map(it => ({ p: it.page, v: it.variant, g: it.grade, t: it.raw })))
  const blRate = () => rates.get('black long collar') || 425
  const layerColors = db && typeof db.layerColors === 'function' ? db.layerColors.bind(db) : null

  // kind: 'clothing' or 'den' when the game says which list defId is from.
  return function lookup ({ defId, color, name, kind } = {}) {
    const id = Number(defId)
    const clothing = kind !== 'den' && db && Number.isFinite(id) ? db.getClothing(id) : null
    const den = !clothing && kind !== 'clothing' && db && Number.isFinite(id) ? db.getDenItem(id) : null
    // The game's name may already carry a worth label ("Worth in item names").
    const shown = typeof name === 'string' ? name.split(SEPARATOR)[0].trim() : ''
    const itemName = (clothing && clothing.name) || (den && den.name) || shown
    if (!itemName) return { found: false }

    const exactRows = () => match.rowsFor(index, itemName, null).filter(row => !row._wikiNameCandidate)
    let rows = []
    let scope = 'item'
    let gameColor = null
    if (clothing) {
      const item = { ...clothing, id }
      const variant = match.itemColorVariant(item, color, layerColors)
      gameColor = (variant && variant.name) || null
      rows = match.rowsForGameItem(index, item, color, layerColors)
      if (rows.some(row => row._wikiColorMatch)) scope = 'color'
      if (!rows.length) {
        rows = exactRows()
        if (rows.length > 1) scope = 'all colors'
      }
    } else {
      rows = exactRows()
      if (rows.length > 1) scope = 'all versions'
    }

    if (!rows.length) return { found: true, name: itemName, color: gameColor, matched: false }

    const ranges = rows.map(row => value.inDiamonds(row.raw || '', rates)).filter(Boolean)
    const diamonds = ranges.length
      ? { min: Math.min(...ranges.map(r => r.min)), max: Math.max(...ranges.map(r => r.max)) }
      : null
    const bl = diamonds ? ((diamonds.min + diamonds.max) / 2) / blRate() : null
    const wikiColors = [...new Set(rows.filter(row => row._wikiColorMatch).map(row => row.variant).filter(Boolean))]
    const updated = rows.map(row => row.editedAt || row.lastUpdated).filter(Boolean).sort().pop() || null
    return {
      found: true,
      matched: true,
      name: itemName,
      color: wikiColors.length === 1 ? wikiColors[0] : gameColor,
      scope, // 'color' (this exact color), 'item', 'all colors', 'all versions'
      diamonds,
      bl,
      lines: rows.slice(0, MAX_LINES).map(match.describeRow),
      more: Math.max(0, rows.length - MAX_LINES),
      image: match.imageForRows(rows) || null,
      updated: updated ? String(updated).slice(0, 10) : null,
      url: rows[0].url || null
    }
  }
}

module.exports = { createWorthLookup }
