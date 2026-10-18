'use strict'

/**
 * JR themes. Each is a hue for the background greys plus an accent color
 * for buttons and switches. Midnight is JR's original monochrome look.
 */

const THEMES = [
  { id: 'midnight', name: 'Midnight', hue: 240, sat: 4, accent: '#f4f4f5', ink: '#0b0b0c' },
  { id: 'graphite', name: 'Graphite', hue: 240, sat: 3, accent: '#d4d4d8', ink: '#121214', lift: 4 },
  { id: 'ocean', name: 'Ocean', hue: 215, sat: 30, accent: '#60a5fa', ink: '#06101f' },
  { id: 'forest', name: 'Forest', hue: 150, sat: 22, accent: '#4ade80', ink: '#052e16' },
  { id: 'violet', name: 'Violet', hue: 262, sat: 26, accent: '#a78bfa', ink: '#160d2e' },
  { id: 'rose', name: 'Rose', hue: 335, sat: 24, accent: '#f472b6', ink: '#2a0a1a' },
  { id: 'amber', name: 'Amber', hue: 35, sat: 26, accent: '#fbbf24', ink: '#1f1503' },
  { id: 'crimson', name: 'Crimson', hue: 355, sat: 28, accent: '#f87171', ink: '#2a0707' }
]

// Lightness of each grey in Midnight, darkest to lightest.
const SCALE = {
  '--bg': 4.5,
  '--panel': 6.3,
  '--panel-2': 7.3,
  '--raise': 9,
  '--raise-2': 10.5,
  '--line': 12.7,
  '--line-2': 17,
  '--line-3': 23.7,
  '--faint-2': 37,
  '--faint': 44,
  '--dim-2': 55,
  '--dim': 66,
  '--text-2': 84,
  '--text': 93
}

function themeById (id) {
  return THEMES.find(t => t.id === id) || THEMES[0]
}

/** CSS variables for a theme. */
function variables (id) {
  const t = themeById(id)
  const vars = {}
  for (const [name, light] of Object.entries(SCALE)) {
    // Dark greys get the theme's tint; text stays nearly neutral.
    const isText = light > 30
    const sat = isText ? Math.min(t.sat, 10) : t.sat
    const l = light < 30 ? light + (t.lift || 0) : light
    vars[name] = `hsl(${t.hue} ${sat}% ${l}%)`
  }
  vars['--accent'] = t.accent
  vars['--accent-ink'] = t.ink
  return vars
}

/** Applies a theme to a document (the JR window or a plugin window). */
function applyTheme (doc, id) {
  const root = doc.documentElement
  for (const [k, v] of Object.entries(variables(id))) root.style.setProperty(k, v)
  root.dataset.theme = themeById(id).id
}

module.exports = { THEMES, themeById, variables, applyTheme }
