'use strict'

/**
 * Small helpers behind JR's quality-of-life features, kept apart from the
 * window code so they can be tested.
 */

/** Splits "ka, umo  rj" into ['ka', 'umo', 'rj']. */
function terms (text) {
  return String(text || '').toLowerCase().split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
}

/**
 * Decides which packets the Network tab shows.
 * `show` keeps only packets whose type is the term or whose text contains it.
 * `hide` drops packets whose type is one of its terms or whose text contains
 * one of them. Hide wins over show.
 */
function packetFilter ({ show = '', hide = '' } = {}) {
  const want = String(show || '').trim().toLowerCase()
  const drop = terms(hide)
  return (p) => {
    const type = String(p.type || '').toLowerCase()
    const raw = String(p.raw || '').toLowerCase()
    if (drop.some(t => type === t || raw.includes(t))) return false
    if (!want) return true
    return type === want || raw.includes(want)
  }
}

/** Adds `term` to a hide list (as text), without duplicates. */
function addHideTerm (hide, term) {
  const list = terms(hide)
  const t = String(term || '').trim().toLowerCase()
  if (t && !list.includes(t)) list.push(t)
  return list.join(', ')
}

/**
 * Tab completion for the console. Returns { value } to put in the box,
 * and `matches` when there's more than one to choose from.
 */
function completeCommand (input, names) {
  const text = String(input || '')
  if (/\s/.test(text.trim()) || text !== text.trimStart()) return { value: text, matches: [] }
  const typed = text.toLowerCase()
  const matches = [...new Set([...names].map(n => String(n).toLowerCase()))].filter(n => n.startsWith(typed)).sort()
  if (!matches.length) return { value: text, matches: [] }
  if (matches.length === 1) return { value: matches[0] + ' ', matches }
  let common = matches[0]
  for (const m of matches) {
    let i = 0
    while (i < common.length && common[i] === m[i]) i++
    common = common.slice(0, i)
  }
  return { value: common.length > typed.length ? common : text, matches }
}

/** Adds a line to the console history: no blanks, no repeats in a row, at most `max`. */
function pushHistory (history, line, max = 100) {
  const list = Array.isArray(history) ? history.filter(x => typeof x === 'string') : []
  const t = String(line || '').trim()
  if (t && list[list.length - 1] !== t) list.push(t)
  return list.slice(-max)
}

/**
 * Where to reopen a window. `saved` is the last { x, y, width, height };
 * `area` is the work area of the screen it was on. A window that would end
 * up mostly off screen (the monitor was unplugged, say) keeps its size but
 * lets the system place it.
 */
function placeWindow (saved, area, { minWidth = 860, minHeight = 600 } = {}) {
  if (!saved || !(saved.width > 0) || !(saved.height > 0) || !area) return {}
  const width = Math.max(minWidth, Math.min(Math.round(saved.width), area.width))
  const height = Math.max(minHeight, Math.min(Math.round(saved.height), area.height))
  const x = Math.round(saved.x)
  const y = Math.round(saved.y)
  const onScreen = Number.isFinite(x) && Number.isFinite(y) &&
    x + width > area.x + 80 && x < area.x + area.width - 80 &&
    y >= area.y - 8 && y < area.y + area.height - 80
  return onScreen ? { x, y, width, height } : { width, height }
}

const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5]

/** The next zoom level up (+1) or down (-1), or back to 100% (0). */
function nextZoom (current, direction) {
  if (direction === 0) return 1
  const now = Number(current) || 1
  if (direction > 0) return ZOOM_STEPS.find(z => z > now + 0.001) || ZOOM_STEPS[ZOOM_STEPS.length - 1]
  return [...ZOOM_STEPS].reverse().find(z => z < now - 0.001) || ZOOM_STEPS[0]
}

/** The "What's new" entry to show after an update, or null. */
function whatsNewFor (notes, version, lastSeen) {
  if (!notes || !version || lastSeen === version) return null
  const entry = notes[version]
  return entry && Array.isArray(entry.items) && entry.items.length ? { version, ...entry } : null
}

/** Turns an "Uncaught (in promise) TypeError: x" console line into "TypeError: x". */
function cleanError (message) {
  return String(message || '').replace(/^Uncaught\s+(\(in promise\)\s+)?/, '').trim() || 'Unknown error'
}

module.exports = { terms, packetFilter, addHideTerm, completeCommand, pushHistory, placeWindow, nextZoom, ZOOM_STEPS, whatsNewFor, cleanError }
