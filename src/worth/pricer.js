'use strict'

/**
 * Item values from the Animal Jam Item Worth Wiki, in Diamonds.
 *
 * The same rules as JR's Trading page: find the wiki rows for a game item
 * (and its color, for clothing), then turn the wiki's value text into a
 * Diamond range using exchange rates worked out from the wiki itself.
 *
 *   const pricer = createPricer({ root, items })
 *   pricer.value({ kind: 'clothing', id: 439, color: 1432961365 })
 *     -> { rows, text, diamonds: { min, max } | null, image, color }
 */

const fs = require('fs')
const path = require('path')

function createPricer ({ root, items, worthItems, pictureColors }) {
  const match = require(path.join(root, 'src', 'worth', 'match.js'))
  const value = require(path.join(root, 'src', 'worth', 'value.js'))
  let list = worthItems
  if (!list) {
    try { list = JSON.parse(fs.readFileSync(path.join(root, 'data', 'worth', 'values.json'), 'utf8')).items || [] } catch (_) { list = [] }
  }
  const index = match.indexWorth(list)
  const rates = value.buildRates(list.map(it => ({ p: it.page, v: it.variant, g: it.grade, t: it.raw })))
  const cache = new Map()

  // Main colors of each wiki picture (tools/worth-scraper/image-colors.js).
  let pictures = null
  const pictureMatcher = () => {
    if (pictures === null) {
      let colors = pictureColors
      if (!colors) {
        try { colors = JSON.parse(fs.readFileSync(path.join(root, 'data', 'worth', 'image-colors.json'), 'utf8')) } catch (_) { colors = null }
      }
      pictures = colors ? require(path.join(root, 'src', 'worth', 'picture.js')).createPictureMatcher(colors) : false
    }
    return pictures || null
  }
  const pictureCache = new Map()
  /** The wiki row whose picture matches this color of a clothing item, if clear. */
  function pictureRow (item) {
    const pm = pictureMatcher()
    if (!pm || item.kind !== 'clothing' || item.color == null || typeof items.layerColors !== 'function') return null
    const def = items.getClothing(item.id)
    if (!def || !def.name || !Array.isArray(def.colors) || def.colors.length < 2) return null
    if (/\bspiked (collar|wristband)s?\b/i.test(def.name)) return null // sized by length, not color
    if (!pictureCache.has(item.id)) {
      const own = squash(def.name)
      const wiki = match.rowsFor(index, def.name, null)
        .filter(r => !r._wikiNameCandidate && r.image && match.colorTerms(r.variant).length && !otherItemsPicture(r, 'clothing', own))
      const game = def.colors.map(c => ({ key: Number(c) >>> 0, layers: items.layerColors(c) }))
        .filter(g => Array.isArray(g.layers) && g.layers.length && g.layers.every(v => v != null))
      pictureCache.set(item.id, wiki.length >= 2 && game.length >= 2 ? pm.match(game, wiki) : new Map())
    }
    return pictureCache.get(item.id).get(Number(item.color) >>> 0) || null
  }

  // Wiki pictures are usually named after the exact game item, e.g.
  // "ExclusiveCrocodilePlushie9PNG.png". JR uses that to catch rows that
  // belong to a different, more specific item with a similar name.
  const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  const pictureName = (url) => {
    const m = /\/images\/[0-9a-f]\/[0-9a-f]{2}\/([^/?]+)/.exec(String(url || ''))
    if (!m) return null
    let f
    try { f = decodeURIComponent(m[1]) } catch (_) { f = m[1] }
    f = f.replace(/\.(png|jpe?g|gif|webp)$/i, '').replace(/(png|jpe?g)$/i, '').replace(/[_\s-]*\d+$/, '')
    return squash(f) || null
  }
  let gameNames = null // kind -> Set of squashed game item names
  const gameNameSet = (kind) => {
    if (!gameNames) {
      gameNames = { clothing: new Set(), den: new Set() }
      for (const k of ['clothing', 'den']) {
        const map = items[k]
        if (map && typeof map.values === 'function') for (const it of map.values()) if (it && it.name) gameNames[k].add(squash(it.name))
      }
    }
    return gameNames[kind] || new Set()
  }
  let byPicture = null // squashed picture name -> wiki rows
  const rowsByPicture = (name) => {
    if (!byPicture) {
      byPicture = new Map()
      for (const row of list) {
        const pic = pictureName(row.image)
        if (!pic) continue
        if (!byPicture.has(pic)) byPicture.set(pic, [])
        byPicture.get(pic).push(row)
      }
    }
    return byPicture.get(name) || []
  }
  /** True when the row's picture is of a more specific game item than this one. */
  const otherItemsPicture = (row, kind, own) => {
    const pic = pictureName(row.image)
    return !!(pic && pic !== own && pic.includes(own) && gameNameSet(kind).has(pic))
  }

  const nameOf = (item) => {
    try {
      const def = item.kind === 'den' ? items.getDenItem(item.id) : items.getClothing(item.id)
      if (def && def.name) return def.name
    } catch (_) {}
    return null
  }

  function nameRows (item, name) {
    if (item.kind === 'den') return match.rowsFor(index, name, null)
    const def = items.getClothing(item.id)
    const game = def ? { ...def, id: Number(item.id) } : { id: Number(item.id), name }
    const layers = items.layerColors ? items.layerColors.bind(items) : undefined
    return match.rowsForGameItem(index, game, item.color, layers)
  }

  function rows (item) {
    if (!item || item.id == null || (item.kind !== 'clothing' && item.kind !== 'den')) return []
    const name = nameOf(item)
    if (!name) return []
    const own = squash(name)
    // Drop rows whose picture shows a different item ("Exclusive Crocodile
    // Plushie" rows are not the plain Crocodile Plushie's value).
    const found = nameRows(item, name).filter(row => !otherItemsPicture(row, item.kind, own))
    // For clothing colors, the wiki pictures say which row is which color.
    const pic = pictureRow(item)
    if (pic) {
      const picked = { ...pic, _wikiColorMatch: true, _wikiPictureColor: true }
      const nameValue = found.length ? match.valueForRows(found, '') : ''
      if (!nameValue || found.some(r => r.id === pic.id) || new Set(found.map(r => String(r.raw || '').trim())).has(String(pic.raw || '').trim())) {
        return found.length && found.every(r => String(r.raw || '').trim() === String(pic.raw || '').trim()) ? found : [picked]
      }
      // Name and picture disagree: a near-exact picture wins, otherwise keep the name match.
      return pic._pictureCost <= 3 ? [picked] : found
    }
    if (found.length) return found
    // "Rare Headdress" is the "Rare Item Monday" row on the Headdress page.
    const rare = /^rare\s+(.+)$/i.exec(name)
    // Only when that's the page's one value: some pages list other versions
    // too ("Rare Nerd Glasses" is the yellow-tape pair, but the page's Rare
    // Item Monday row is the white-tape one).
    if (rare) {
      const raw = (r) => String(r.raw || '').trim()
      // Color rows ("Blue", "Red") are the plain item's colors, not versions.
      const page = match.rowsFor(index, rare[1], null).filter(row => !row._wikiNameCandidate && !match.colorTerms(row.variant).length)
      const rim = page.filter(row => /^(rare item monday|rim|rare)$/i.test(String(row.variant || '').trim()))
      if (rim.length && new Set(rim.map(raw)).size === 1) {
        if (new Set(page.map(raw)).size === 1) return rim.map(r => ({ ...r, _wikiRareRow: true }))
        const picked = rowsByPictureColor(item, page)
        if (picked.length) return picked.map(r => ({ ...r, _wikiRareRow: true }))
        // Can't tell which version this is: show them all, priced as unclear.
        return page.map(r => ({ ...r, _wikiRareRow: true }))
      }
    }
    // Nothing by name: use rows whose picture is named after this exact item,
    // when they all agree on one value.
    const pictured = rowsByPicture(own)
    if (!pictured.length) return []
    const values = new Set(pictured.map(r => String(r.raw || '').trim()))
    return values.size === 1 ? pictured.map(r => ({ ...r, _wikiPictureMatch: true })) : []
  }

  /** The rows of one item's page whose picture names this item's color. */
  function rowsByPictureColor (item, page) {
    if (item.kind !== 'clothing' || typeof items.layerColors !== 'function') return []
    const def = items.getClothing(item.id)
    if (!def) return []
    const color = item.color != null ? item.color : Array.isArray(def.colors) ? def.colors[0] : null
    return match.rowsByPictureColor(page, match.itemColorVariant({ ...def, id: Number(item.id) }, color, items.layerColors.bind(items)))
  }

  function storePrice (item) {
    try {
      const def = item.kind === 'den' ? items.getDenItem(item.id) : items.getClothing(item.id)
      const cost = def && Number(def.cost)
      return cost > 0 ? { cost, currency: def.currency === 'diamonds' ? 'Diamonds' : 'Gems', members: !!def.members } : null
    } catch (_) { return null }
  }

  /** Everything known about one item's value. Cached per item and color. */
  function valueOf (item) {
    const key = `${item.kind}:${item.id}:${item.color == null ? '' : Number(item.color) >>> 0}`
    if (cache.has(key)) return cache.get(key)
    const found = rows(item)
    const text = match.valueForRows(found, '')
    let diamonds = null
    // Only price items JR matched to one clear wiki value.
    const ranges = text ? found.map(row => value.inDiamonds(row.raw || '', rates)).filter(Boolean) : []
    if (ranges.length) {
      const min = Math.min(...ranges.map(r => r.min))
      const max = Math.max(...ranges.map(r => r.max))
      // Very different matches means JR can't tell which one is yours.
      if (!(ranges.length > 1 && max > min * 3)) diamonds = { min, max }
    }
    // Is the item itself on the wiki, or did only similar names match
    // ("Pink Lamp" finding the Pink row of every lamp)?
    const own = squash(nameOf(item))
    const listed = diamonds != null || found.some(r => r._wikiColorMatch || r._wikiPictureColor || r._wikiRareRow || r._wikiPictureMatch ||
      [r.page, r.section, r.variant, r.name].some(x => x && squash(x) === own))
    const labels = item.kind === 'clothing' ? [...new Set(found.filter(r => r._wikiColorMatch).map(r => r.variant).filter(Boolean))] : []
    const result = {
      name: nameOf(item),
      rows: found,
      text,
      diamonds,
      image: match.imageForRows(found),
      source: [...new Set(found.map(r => r.page).filter(Boolean))].slice(0, 2).join(', '),
      color: labels.length === 1 ? labels[0] : null,
      // The game's own shop price, for items the wiki doesn't value.
      // (only when the wiki doesn't list it, or says it's still sold).
      store: !listed || /currently in stores/i.test(text) ? storePrice(item) : null,
      status: /currently in stores/i.test(text) ? 'store' : /under investigation|hard to value/i.test(text) ? 'unknown' : listed && !diamonds ? 'unclear' : null
    }
    cache.set(key, result)
    return result
  }

  const blRate = () => rates.get('black long collar') || 425
  const round = (n) => (n >= 100 ? Math.round(n / 5) * 5 : Math.round(n))
  const middle = (r) => (r.min + r.max) / 2

  /** "≈ 400–450 Diamonds · 1 BL" */
  function format (r, { bl = true } = {}) {
    if (!r) return ''
    const d = r.min === r.max || round(r.min) === round(r.max) ? round(r.min).toLocaleString() : `${round(r.min).toLocaleString()}–${round(r.max).toLocaleString()}`
    const b = middle(r) / blRate()
    return `≈ ${d} Diamond${d === '1' ? '' : 's'}${bl && b >= 0.25 ? ` · ${b >= 10 ? Math.round(b) : Math.round(b * 10) / 10} BL` : ''}`
  }

  /** A sensible shop price: the middle of the wiki range, rounded. */
  function suggestedPrice (r) {
    if (!r) return null
    const m = middle(r)
    return Math.max(1, m >= 100 ? Math.round(m / 5) * 5 : Math.round(m))
  }

  return { value: valueOf, rows, format, suggestedPrice, blRate, rates, entries: list.length }
}

module.exports = { createPricer }
