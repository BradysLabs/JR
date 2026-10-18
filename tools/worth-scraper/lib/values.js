/**
 * Turns the wiki's free-text worth ("18-19 Black Long Collars",
 * "10-11 Den Betas OR 2 Good Short Collars", "15-20 RIMs / 1-2 Diamonds")
 * into structured offers. The original text is always kept, so nothing is
 * lost when a value can't be read.
 */

const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 }

// Canonical names for the units jammers price things in.
const UNITS = [
  [/^black\s+long(?:\s+spiked?)?\s+collars?$|^black\s+longs?$|^solids?$/i, 'Black Long Collars'],
  [/^variety(?:\s+headdress(?:es)?)?$|^variety\s+hds?$/i, 'Variety'],
  [/^den\s+betas?$/i, 'Den Betas'],
  [/^clothing\s+betas?$/i, 'Clothing Betas'],
  [/^diamonds?$/i, 'Diamonds'],
  [/^rims?$|^rare\s+item\s+mondays?$/i, 'RIMs'],
  [/^gems?$/i, 'Gems'],
  [/^sapphires?$/i, 'Sapphires']
]

const NUM = '(\\d+(?:\\.\\d+)?|\\d+\\s*\\/\\s*\\d+|' + Object.keys(WORDS).join('|') + ')'
const QTY_RE = new RegExp('^(?:about|around|roughly|~)?\\s*' + NUM + '(?:\\s*(?:-|–|—|to)\\s*' + NUM + ')?\\s*(\\+)?\\s+(.+)$', 'i')

const toNumber = (s) => {
  if (s == null) return null
  const w = WORDS[String(s).toLowerCase()]
  if (w !== undefined) return w
  const frac = String(s).match(/^(\d+)\s*\/\s*(\d+)$/)
  if (frac) return Number(frac[1]) / Number(frac[2])
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Normalises a unit name; returns { unit, known }. */
function unitOf (raw) {
  const cleaned = raw
    .replace(/[.,;:!]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  for (const [re, name] of UNITS) {
    if (re.test(cleaned)) return { unit: name, known: true }
  }
  // Plural "Bad Long Collars" and singular "Bad Long Collar" are the same unit.
  const singular = cleaned.replace(/(collar|wristband|headdress|beta|item|pet|hat|bow)s\b/gi, (m, w) => w).replace(/headdresse\b/i, 'headdress')
  return { unit: singular.replace(/\b\w/g, (c) => c.toUpperCase()), known: false }
}

/** Reads one "quantity + unit" piece, e.g. "3-4 Den Betas". */
function readPiece (piece) {
  let s = piece.trim().replace(/^\(|\)$/g, '').trim()
  let note = null
  // "80 Den Betas, depends on Jammer" / "110 Black Long Collars, maybe more"
  const comma = s.match(/^(.*?\d.*?[A-Za-z][^,(]*?)\s*[,(]\s*(.+?)\)?$/)
  if (comma) { s = comma[1]; note = comma[2] }
  const m = s.match(QTY_RE)
  if (!m) return null
  const min = toNumber(m[1])
  const max = m[2] != null ? toNumber(m[2]) : min
  if (min == null || max == null) return null
  const { unit, known } = unitOf(m[4])
  const atLeast = !!m[3] || /maybe more|or more|\+$|at least/i.test(note || '')
  return { min: Math.min(min, max), max: Math.max(min, max), unit, knownUnit: known, atLeast, note }
}

/**
 * Splits a value cell into alternative offers and reads each one.
 * @param {string} text - Cell text (newlines kept from <br>).
 * @returns {Array<{text, min?, max?, unit?, atLeast?, note?, bundle?}>}
 */
function parseOffers (text) {
  if (!text) return []
  const flat = text.replace(/\s*\n\s*/g, ' \n ').trim()
  // Alternatives: "OR", or " / " with spaces (so "1/10" stays a fraction).
  const parts = flat
    .split(/\s+\bOR\b\s+|\s*\n\s*or\s+|\s+\/\s+/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').replace(/\s+OR$/, '').trim())
    .filter(Boolean)

  return parts.map((part) => {
    const offer = { text: part }
    if (/\s\+\s/.test(part)) {
      // A bundle: "2 Red Long Collars + Bad Long Collar" or "+ add".
      const pieces = part.split(/\s\+\s/).map((p) => p.trim())
      offer.bundle = pieces.map((p) => {
        if (/^add$/i.test(p)) return { add: true, text: p }
        return readPiece(p) || readPiece('1 ' + p) || { text: p }
      })
      return offer
    }
    const read = readPiece(part)
    if (read) Object.assign(offer, read)
    return offer
  })
}

module.exports = { parseOffers, unitOf, readPiece }
