'use strict'

/**
 * Item search for JR's previewers: every word you type must be in the
 * item's name, in any order, and plurals find singular names
 * ("mannequins" finds "Wolf Mannequin", "wolf hats" finds "Wolf Hat").
 * An item ID finds that item.
 */

const norm = (text) => String(text || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** The ways a typed word might appear in a name: as typed, and without a plural ending. */
function forms (word) {
  const out = [word]
  if (word.length > 3 && word.endsWith('ies')) out.push(word.slice(0, -3) + 'y')
  if (word.length > 3 && /(ches|shes|sses|xes|zes)$/.test(word)) out.push(word.slice(0, -2))
  if (word.length > 2 && word.endsWith('s') && !word.endsWith('ss')) out.push(word.slice(0, -1))
  return out
}

/** A test for one search: (name, id) -> whether it matches. */
function itemMatcher (query) {
  const q = norm(query)
  if (!q) return () => true
  const words = q.split(' ').map(forms)
  return (name, id) => {
    if (id != null && String(id) === q) return true
    const n = norm(name)
    return words.every(alts => alts.some(w => n.includes(w)))
  }
}

module.exports = { itemMatcher }
