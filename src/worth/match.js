'use strict'

const normalizedCache = new Map()
function normalize (value) {
  const source = String(value || '')
  if (normalizedCache.has(source)) return normalizedCache.get(source)
  const decomposed = /^[\x00-\x7F]*$/.test(source) ? source : source.normalize('NFKD')
  const result = decomposed.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (normalizedCache.size >= 50000) normalizedCache.clear()
  normalizedCache.set(source, result)
  return result
}

const NAME_ALIASES = {
  'rare spiked wristband': ['rare short spiked wristband', 'rare long spiked wristband'],
  'rare spiked collar': ['rare short spiked collar', 'rare long spiked collar'],
  'spiked wristband': ['diamond short spiked wristbands', 'diamond long spiked wristbands'],
  'spiked collar': ['diamond short spiked collars', 'diamond long spiked collars']
}

function keysForName (value) {
  const key = normalize(value)
  return key ? [key, ...(NAME_ALIASES[key] || [])] : []
}

function isValuationRow (item) {
  const offers = Array.isArray(item.offers) ? item.offers : []
  const hasOffer = offers.some(offer => offer && (
    (typeof offer.text === 'string' && offer.text.trim()) ||
    Number.isFinite(offer.min) || Number.isFinite(offer.max) || offer.bundle
  ))
  const hasStructuredValue = offers.some(offer => offer && (
    Number.isFinite(offer.min) || Number.isFinite(offer.max) || offer.bundle
  ))
  const hasPlainTradeValue = offers.some(offer => offer && typeof offer.text === 'string' &&
    /\b(?:bad|decent|good|best|black|white|red|blue|green|yellow|orange|pink|purple)\s*(?:-\s*)?(?:bad|decent|good|best)?\s*(?:short|long)\s+(?:spiked\s+)?(?:collars?|wrists?|wristbands?)\b/i.test(offer.text))
  return Boolean(hasOffer && ((typeof item.variant === 'string' && item.variant.trim()) || item.grade || hasStructuredValue || hasPlainTradeValue))
}

const COLOR_TERMS = [
  'light blue', 'dark blue', 'light green', 'dark green', 'dark purple',
  'black', 'white', 'gray', 'grey', 'red', 'orange', 'yellow', 'green', 'blue',
  'purple', 'pink', 'magenta', 'brown', 'tan', 'teal', 'turquoise', 'aqua',
  'cyan', 'lavender', 'gold', 'silver', 'rainbow'
]

function colorTerms (value) {
  const text = normalize(value)
  const found = COLOR_TERMS.filter(term => new RegExp(`\\b${term}\\b`, 'i').test(text))
  return found.filter(term => !found.some(other => other !== term && other.endsWith(` ${term}`)))
}

function spikedFamily (value) {
  const key = normalize(value)
  if (/\bspiked collars?\b/.test(key)) return 'spiked collar'
  if (/\bspiked wristbands?\b/.test(key)) return 'spiked wristband'
  return null
}

function indexWorth (items) {
  const index = new Map()
  const allRows = new Map()
  const add = (key, item) => {
    if (!key) return
    if (!index.has(key)) index.set(key, new Map())
    index.get(key).set(item.id, item)
  }

  for (const item of items || []) {
    if (!isValuationRow(item)) continue
    allRows.set(item.id, item)
    for (const field of [item.name, item.page, item.section]) {
      for (const key of keysForName(field)) add(key, item)
    }

    // Some wiki pages list the item itself in the variant column (for example
    // Rare Sombrero or Ghostly Skunk Tail). Index meaningful multiword labels,
    // but not bare color words such as "Blue" or "Default".
    const variant = normalize(item.variant)
    if (variant.split(' ').length > 1) {
      for (const key of keysForName(variant)) add(key, item)
    }

    // A few tables put only a color in the variant column and the item family
    // in the page title: e.g. Magenta + Diamond Short Spiked Collars.
    const family = spikedFamily(item.page)
    if (family && variant && colorTerms(variant).length) {
      add(`${variant} ${family}`, item)
    }
  }

  const result = new Map([...index].map(([key, rows]) => [key, [...rows.values()]]))
  result.wordIndex = new Map()
  for (const row of allRows.values()) {
    const words = new Set(normalize([row.page, row.name, row.section, row.variant].filter(Boolean).join(' ')).split(' ').filter(Boolean))
    const entry = { row, words }
    for (const word of words) {
      if (!result.wordIndex.has(word)) result.wordIndex.set(word, [])
      result.wordIndex.get(word).push(entry)
    }
  }
  result.candidateCache = new Map()
  return result
}

const COLOR_WORDS = {
  gray: ['gray', 'grey', 'silver'],
  pink: ['pink', 'magenta', 'rose'],
  teal: ['teal', 'turquoise', 'aqua', 'cyan'],
  tan: ['tan', 'brown', 'beige', 'peach'],
  brown: ['brown', 'umber'],
  yellow: ['yellow', 'gold'],
  orange: ['orange', 'peach'],
  blue: ['blue', 'cyan'],
  'light blue': ['light blue', 'blue'],
  'dark blue': ['dark blue', 'blue'],
  green: ['green'],
  'light green': ['light green'],
  'dark green': ['dark green'],
  purple: ['purple', 'violet', 'lavender', 'dark purple'],
  'dark purple': ['dark purple', 'purple', 'violet', 'lavender']
}

function colorVariantRows (rows, variant) {
  const colorRows = rows.filter(row => colorTerms(row.variant).length)
  if (!colorRows.length || !variant || !Array.isArray(variant.layers)) return []

  const expand = names => names.flatMap(value => COLOR_WORDS[value] || [value])
  const changing = variant.layers.filter(layer => layer.varied)
  const actual = new Set(expand((changing.length ? changing : variant.layers.slice(0, 1)).flatMap(layer => layer.names)))
  const primary = new Set(expand(variant.names || []))
  const scores = colorRows.flatMap(row => {
    const terms = colorTerms(row.variant)
    const matched = terms.filter(term => actual.has(term)).length
    // A combination is usable only when every color named by the wiki row
    // occurs in the game's changing palette layers. Partial matches caused
    // unrelated colors to win for two-tone items.
    if (!terms.length || matched !== terms.length) return []
    return [{ row, score: [matched, terms.filter(term => primary.has(term)).length, terms.length] }]
  })
  if (!scores.length) return []

  const compare = (a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
    return 0
  }
  const best = scores.reduce((score, entry) => compare(entry.score, score) > 0 ? entry.score : score, [-1, -1, -1])
  return scores.filter(entry => compare(entry.score, best) === 0).map(entry => ({ ...entry.row, _wikiColorMatch: true }))
}

function colorNames (rgb) {
  if (rgb == null || !Number.isFinite(Number(rgb))) return null
  const hex = Number(rgb).toString(16).padStart(6, '0').slice(-6)
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  const light = (max + min) / 2
  const linear = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
  if (delta < 0.12) return [luminance < 0.10 ? 'black' : luminance > 0.55 ? 'white' : 'gray']
  let hue
  if (max === r) hue = 60 * (((g - b) / delta) % 6)
  else if (max === g) hue = 60 * ((b - r) / delta + 2)
  else hue = 60 * ((r - g) / delta + 4)
  if (hue < 0) hue += 360
  if (hue < 14 || hue >= 345) return [light > 0.55 && hue >= 345 ? 'pink' : 'red']
  // The Animal Jam palette uses orange and yellow swatches close together:
  // e.g. #e08654 is orange, while #f7cd66 is yellow. A broad hue cutoff
  // mislabeled the yellow option as orange and muted orange as tan.
  if (hue < 38 && light < 0.34) return ['brown']
  const saturation = delta / (1 - Math.abs(2 * light - 1) || 1)
  if (hue < 38 && saturation < 0.45 && light > 0.38) return ['tan']
  if (hue < 38) return ['orange']
  if (hue < 75) return ['yellow']
  if (hue < 165) return [light < 0.30 ? 'dark green' : light > 0.72 ? 'light green' : 'green']
  if (hue < 185) return ['green', 'teal']
  if (hue < 205) return [light > 0.55 ? 'light blue' : 'blue', 'teal']
  if (hue < 245) return [light > 0.72 ? 'light blue' : 'blue']
  if (hue < 300) return [light < 0.36 ? 'dark purple' : 'purple']
  return ['pink']
}

function colorName (rgb) { return colorNames(rgb)?.[0] || null }

// Resolve a packed inventory color to its exact 0-based option in this item's
// game definition. The primary category comes from the most variable palette
// layer of this item; equal-diversity layers keep the first game layer.
function itemColorVariant (item, packedColor, layerColors) {
  const choices = item && Array.isArray(item.colors) ? item.colors : []
  if (packedColor == null || !Number.isFinite(Number(packedColor))) return { index: -1, name: null, names: [], layerIndex: -1, rgb: null }
  const selected = choices.findIndex(value => (Number(value) >>> 0) === (Number(packedColor) >>> 0))
  if (selected < 0 || typeof layerColors !== 'function') return { index: selected, name: null, names: [], layerIndex: -1, rgb: null }
  const decoded = choices.map(value => layerColors(value))
  const layerCount = Math.min(4, ...decoded.map(layers => Array.isArray(layers) ? layers.length : 0))
  if (!layerCount) return { index: selected, name: null, names: [], layerIndex: -1, rgb: null }
  let bestLayer = -1
  let bestCount = 1
  const distinctByLayer = []
  for (let layer = 0; layer < layerCount; layer++) {
    const names = decoded.map(layers => Number.isFinite(Number(layers[layer])) ? colorName(layers[layer]) : null)
    if (names.some(name => !name)) { distinctByLayer.push(0); continue }
    const count = new Set(names).size
    distinctByLayer.push(count)
    if (count > bestCount) { bestCount = count; bestLayer = layer }
  }
  if (bestLayer < 0 && choices.length === 1) bestLayer = 0
  if (bestLayer < 0) return { index: selected, name: null, names: [], layerIndex: -1, rgb: null }
  const names = colorNames(decoded[selected][bestLayer]) || []
  const layers = decoded[selected].slice(0, layerCount).map((rgb, layerIndex) => ({
    index: layerIndex,
    rgb,
    names: colorNames(rgb) || [],
    varied: distinctByLayer[layerIndex] > 1
  }))
  return { index: selected, name: names.length === 1 ? names[0] : null, names, layerIndex: bestLayer, rgb: decoded[selected][bestLayer], layers }
}

const SPIKE_LENGTH_BY_LAYER_DEF = { 151: 'long', 152: 'short', 153: 'long', 154: 'short' }
// Older cached item lists omit layerDefId. These IDs are from the game's
// clothing pack; #286/option 5 was matched to the user's blue long wristband.
const SPIKE_LENGTH_BY_ITEM_ID = {
  276: 'short', 277: 'short', 285: 'long', 286: 'long',
  634: 'long', 1212: 'short', 1659: 'long', 1855: 'long', 1856: 'short'
}

function spikeLength (item) {
  const name = normalize(item && item.name)
  if (/\bshort\b/.test(name)) return 'short'
  if (/\blong\b/.test(name)) return 'long'
  const layerDefId = Number(item && item.layerDefId)
  return SPIKE_LENGTH_BY_LAYER_DEF[layerDefId] || SPIKE_LENGTH_BY_ITEM_ID[Number(item && item.id)] || null
}

function rowsForGameItem (index, item, packedColor, layerColors) {
  if (!item || !item.name) return []
  const variant = itemColorVariant(item, packedColor, layerColors)
  // Start with every exact-name wiki row. Filtering by a guessed RGB color
  // first can discard the correct page before the item's long/short shape or
  // multi-layer palette has been considered.
  let rows = rowsFor(index, item.name, null).filter(row => !row._wikiNameCandidate)
  const family = spikedFamily(item.name)
  if (!family) {
    const name = normalize(item.name)
    const identity = rows.filter(row => normalize(row.variant) === name)
    if (identity.length) return identity
    const base = rows.filter(row => !row.variant &&
      (normalize(row.page) === name || normalize(row.name) === name) &&
      (!row.section || normalize(row.section) === name || normalize(row.section) === normalize(row.page) || normalize(row.section) === normalize(row.name)))
    if (base.length) return base
    const exactSection = rows.filter(row => normalize(row.section) === name)
    if (exactSection.length) rows = exactSection

    const matched = colorVariantRows(rows, variant)
    if (matched.length) return matched

    // Some pages explicitly say every color is the same value. That is safe
    // to display even when the game's palette label has no direct wiki name.
    const colorRows = rows.filter(row => colorTerms(row.variant).length)
    const signatures = [...new Set(colorRows.map(row => (row.offers || []).map(offer => offer.text).filter(Boolean).join(' · ')).filter(Boolean))]
    return signatures.length === 1 ? colorRows.map(row => ({ ...row, _wikiColorIndependent: true })) : []
  }

  const length = spikeLength(item)
  if (!length) return []
  const rare = /\brare\b/.test(normalize(item.name))
  const page = rare
    ? normalize(`Rare ${length} ${family}`)
    : normalize(`Diamond ${length} ${family}s`)
  rows = rows.filter(row => normalize(row.page) === page)

  const name = normalize(item.name)
  if (name === 'spiked collar' || name === 'spiked wristband') {
    rows = rows.filter(row => /\b(?:first gen|original)\b/.test(normalize(row.section)))
  } else if (!rare) {
    // Named styles such as Neon have their own section on the shared Diamond
    // Shop page. Keep those rows attached to the exact game item name.
    rows = rows.filter(row => normalize(row.section) === name)
  }

  // Where the wiki names a two-tone variant, use every changing game palette
  // layer to select that row. Prefer a complete color combination (Green &
  // Orange) over a partial match on just one layer (Green).
  const matched = colorVariantRows(rows, variant)
  if (matched.length) return matched

  // Some wiki sections list multiple color options but give all of them the
  // same offer. In that case the value is independent of the palette choice.
  const colorRows = rows.filter(row => colorTerms(row.variant).length)
  const signatures = [...new Set(colorRows.map(row => (row.offers || []).map(offer => offer.text).filter(Boolean).join(' · ')).filter(Boolean))]
  return signatures.length === 1 ? colorRows.map(row => ({ ...row, _wikiColorIndependent: true })) : []
}

function rowsFor (index, name, color) {
  let rows = [...new Map(keysForName(name).flatMap(key => index.get(key) || []).map(row => [row.id, row])).values()]
  if (!rows.length && index && index.wordIndex instanceof Map) {
    const key = normalize(name)
    let candidates = index.candidateCache.get(key)
    if (!candidates) {
      const words = key.split(' ').filter(word => word.length > 1)
      const generic = new Set(['rare', 'item', 'default', 'original', 'classic', 'the'])
      const specificWords = words.filter(word => !generic.has(word))
      const postings = specificWords.map(word => index.wordIndex.get(word) || [])
      const smallestPosting = postings.sort((a, b) => a.length - b.length)[0] || []
      const rareSingleTerm = specificWords.length === 1 && specificWords[0].length >= 5 && smallestPosting.length <= 25
      candidates = (specificWords.length < 2 && !rareSingleTerm) || postings.some(posting => !posting.length) ? [] : smallestPosting
        .filter(entry => words.every(word => entry.words.has(word)))
        .slice(0, 100)
        .map(entry => ({ ...entry.row, _wikiNameCandidate: true }))
      index.candidateCache.set(key, candidates)
    }
    rows = candidates
  }
  if (!rows.length) return []
  if (color == null) return rows

  const requestedColors = (Array.isArray(color) ? color : [typeof color === 'string' ? color.toLowerCase() : colorName(color)])
    .flatMap(value => COLOR_WORDS[String(value || '').toLowerCase()] || [String(value || '').toLowerCase()])
    .filter(Boolean)
  if (!requestedColors.length) return rows.map(row => ({ ...row, _wikiColorUnresolved: true }))
  const applicable = []
  const colorSpecific = []
  const nameKey = normalize(name)
  for (const row of rows) {
    const variant = String(row.variant || '')
    const section = normalize(row.section)
    const isIdentity = normalize(variant) === nameKey
    const isBaseRow = !variant &&
      (normalize(row.page) === nameKey || normalize(row.name) === nameKey) &&
      (!section || section === nameKey || section === normalize(row.page) || section === normalize(row.name))
    // Keep the exact item row, but don't treat unrelated sections such as
    // "Rare Item Monday" or "Foolish King" as color-independent values.
    if (isIdentity || isBaseRow) {
      applicable.push(row)
      continue
    }
    if (!colorTerms(variant).length) continue
    colorSpecific.push(row)
  }

  const matchingColors = colorSpecific.filter(row => {
    const terms = colorTerms(row.variant)
    return requestedColors.some(word => terms.includes(word) || (COLOR_WORDS[word] || []).some(alias => terms.includes(alias)))
  })
  if (matchingColors.length) {
    const marked = [
      ...applicable.map(row => ({ ...row, _wikiColorIndependent: true })),
      ...matchingColors.map(row => ({ ...row, _wikiColorMatch: true }))
    ]
    return [...new Map(marked.map(row => [row.id, row])).values()]
  }

  // A color label can be ambiguous or absent from the wiki even when the item
  // itself is present. Keep its wiki rows visible as alternatives; callers
  // must not treat multiple or color-unresolved rows as a confirmed subtotal.
  if (!colorSpecific.length) return applicable.map(row => ({ ...row, _wikiColorIndependent: true }))
  return rows.map(row => ({ ...row, _wikiColorUnmatched: true }))
}

function rowsForInventory (index, name, color) {
  const all = rowsFor(index, name, null).filter(row => !row._wikiNameCandidate)
  if (!all.length) return []
  const nameKey = normalize(name)
  const identity = all.filter(row => normalize(row.variant) === nameKey)
  const base = all.filter(row => !row.variant &&
    (normalize(row.page) === nameKey || normalize(row.name) === nameKey) &&
    (!row.section || normalize(row.section) === nameKey || normalize(row.section) === normalize(row.page) || normalize(row.section) === normalize(row.name)))
  const selected = color == null ? [] : rowsFor(index, name, color).filter(row =>
    !row._wikiNameCandidate && !row._wikiColorUnresolved && !row._wikiColorUnmatched)
  if (selected.length) return selected
  if (identity.length) return identity.map(row => ({ ...row, _wikiColorIndependent: true }))
  if (base.length) return base.map(row => ({ ...row, _wikiColorIndependent: true }))

  // If the wiki gives every color of this exact item the same offer, the
  // user's color option cannot change its listed value.
  const exactPage = all.filter(row => normalize(row.page) === nameKey || normalize(row.name) === nameKey)
  const colorRows = exactPage.filter(row => colorTerms(row.variant).length)
  const signatures = [...new Set(colorRows.map(row => (row.offers || []).map(offer => offer.text).filter(Boolean).join(' · ')).filter(Boolean))]
  return signatures.length === 1 ? colorRows.map(row => ({ ...row, _wikiColorIndependent: true })) : []
}

function describeRow (row) {
  const value = row.offers && row.offers.length
    ? row.offers.map(offer => offer.text).filter(Boolean).join(' · ')
    : row.raw || 'Value not listed'
  const page = normalize(row.page)
  const family = /\bshort\b/.test(page) ? 'Wiki short' : /\blong\b/.test(page) ? 'Wiki long' : null
  const section = row.section && normalize(row.section) !== normalize(row.name) ? row.section : null
  return [family, section, row.variant, row.grade, value].filter(Boolean).join(' · ')
}

function valueForRows (rows, fallback = 'No exact wiki value') {
  if (!Array.isArray(rows) || !rows.length || rows.some(row => row._wikiNameCandidate || row._wikiColorUnresolved || row._wikiColorUnmatched)) return fallback
  const values = rows.map(row => [...new Set((row.offers || []).map(offer => offer.text).filter(Boolean))].join(' · '))
  return values[0] && values.every(value => value === values[0]) ? values[0] : fallback
}

function imageForRows (rows) {
  const images = [...new Set((rows || []).map(row => {
    try {
      const url = new URL(row.image)
      return url.protocol === 'https:' && url.hostname === 'static.wikia.nocookie.net' ? url.href : ''
    } catch (_) { return '' }
  }).filter(Boolean))]
  return images.length === 1 ? images[0] : ''
}

module.exports = { normalize, indexWorth, colorName, colorNames, itemColorVariant, rowsFor, rowsForInventory, rowsForGameItem, spikeLength, describeRow, valueForRows, imageForRows }
