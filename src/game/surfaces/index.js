'use strict'

/**
 * JR inside Animal Jam: every plugin gets a home on the game screen it
 * belongs to (a button on that screen) and a window drawn by the game itself.
 *
 * A surface is one of those windows:
 *   {
 *     id, plugin,                       // plugin id: hidden while that plugin is off
 *     buttons: [{ at, label, icon, local }],  // game screens it gets a button on (see ANCHORS);
 *                                       // icon: round button art; local: the game handles it itself
 *     init(ctx),                        // once: hooks, long-running helpers
 *     view(state, ctx) -> panel,        // what the window shows now
 *     act(state, ctrl, value, inputs, ctx)  // a click or Enter in the window
 *   }
 * A panel is { title, sub, tabs: [{id, l}], tab, rows: [...], foot, w, h };
 * rows are drawn by JRPanel in tools/game-mod/as/JRUI.as:
 *   {t:'h', text}  {t:'p', text, c}  {t:'kv', k, v, c}  {t:'sep'}
 *   {t:'btn', id, label, style, v}  {t:'row', items:[{id, label, style, v}]}
 *   {t:'tog', id, label, sub, v}    {t:'in', id, label, v, go, max, lines}
 *   {t:'chips', id, label, opts:[{v, l}], v}  {t:'sw', id, colors:[hex], v}
 *   {t:'num', id, label, v, step}   {t:'li', id, text, sub, right, c, rc, sel, btns:[{id, label, style, v}]}
 * c / rc colors: dim, ok, warn, bad. Styles: primary, danger, on, normal.
 */

const fs = require('fs')
const path = require('path')

// Where each game screen puts its row of JR buttons, next to its close
// button unless said otherwise. pos: left, right, above, aboveLeft, below,
// belowLeft, belowCenter; dx/dy nudge it. Changing these needs no game rebuild.
const ANCHORS = {
  avatar: { pos: 'left' },
  shop: { pos: 'left' },
  myshop: { pos: 'left' },
  shopview: { pos: 'left' },
  recycle: { pos: 'left' },
  // round buttons: round is a share of the neighbor's height, or pixels above 2
  // Edit Animal: under the item count (below the inventory), under the colors
  avatarinv: { pos: 'belowLeft', round: 36, dx: 4, dy: 6 },
  avatarcolors: { pos: 'belowCenter', round: 32, dy: 3 },
  artstudio: { pos: 'right', round: 1 },
  // JR's More Sorts button by the den item search (the inventory's opens from Sort By)
  densort: { pos: 'right', round: 30 },
  denswitch: { pos: 'left' },
  denedit: { pos: 'left' },
  animals: { pos: 'left' },
  adventure: { pos: 'left' },
  achievements: { pos: 'left' },
  pets: { pos: 'left' },
  masterpiece: { pos: 'left' },
  trade: { pos: 'left' },
  pairs: { pos: 'left' }
}

// The game's own fonts, best first, for JR's windows and buttons.
const PREFERRED_FONTS = [/digital ?delivery/i, /grobold/i, /baloo/i, /fredoka/i, /bubble/i, /cartoon/i, /comic/i]

/** A plugin's saved data, read fresh each time so its JR window and the game agree. */
function fileStore (dir) {
  const file = path.join(dir, 'storage.json')
  const read = () => { try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return d && typeof d === 'object' && !Array.isArray(d) ? d : {} } catch (_) { return {} } }
  return {
    get (key, fallback) { const d = read(); return Object.prototype.hasOwnProperty.call(d, key) ? d[key] : fallback },
    set (key, value) {
      const d = read()
      if (value === undefined) delete d[key]; else d[key] = value
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(file, JSON.stringify(d, null, 2))
    }
  }
}

/**
 * @param {object} o
 * @param {object} o.bridge   createGameBridge result: send(kind, value)
 * @param {object} o.ctx      what surfaces get: dispatch, items, log, ... (see engine.js)
 * @param {object[]} o.surfaces
 * @param {(pluginId: string) => boolean} o.enabled
 */
function createSurfaces ({ bridge, ctx, surfaces, enabled = () => true }) {
  const byId = new Map()
  const states = new Map()
  const open = new Set()
  let font = null

  const host = {
    toast (text, c) { bridge.send('m', { text: String(text || ''), c: c || '' }) },
    /** Redraws a window if it's open in the game. */
    refresh (id) { if (open.has(id)) draw(id, false) },
    refreshAll () { for (const id of open) draw(id, false) },
    close (id) { open.delete(id); bridge.send('x', { id }) },
    /** Opens another surface's window (for buttons that lead elsewhere). */
    open (id, context) { return openSurface(id, null, context || {}) },
    isOpen: (id) => open.has(id),
    state: (id) => stateOf(id),
    store: (pluginId) => fileStore(path.join(ctx.profileDir, 'plugin-data', pluginId))
  }
  const full = Object.assign({}, ctx, { surfaces: host })

  for (const s of surfaces) {
    byId.set(s.id, s)
    if (typeof s.init === 'function') {
      try { s.init(full) } catch (error) { ctx.log({ type: 'warn', message: `In-game ${s.id}: ${error.message}` }) }
    }
  }

  function stateOf (id) {
    if (!states.has(id)) states.set(id, {})
    return states.get(id)
  }

  function panelFor (id) {
    const s = byId.get(id)
    let panel
    try {
      panel = s.view(stateOf(id), full) || {}
    } catch (error) {
      panel = { title: s.title || id, rows: [{ t: 'p', c: 'bad', text: `Couldn’t show this: ${error.message}` }] }
    }
    return Object.assign({ w: 340 }, panel, { id })
  }

  // The last window sent for each surface: an unchanged window isn't sent
  // again, so timed refreshes cost nothing while nothing changes.
  const sent = new Map()
  function draw (id, opening) {
    const panel = panelFor(id)
    const text = JSON.stringify(panel)
    if (!opening && sent.get(id) === text) return
    sent.set(id, text)
    if (opening) panel.open = true
    bridge.send('v', panel)
  }

  function openSurface (id, anchor, context) {
    const s = byId.get(id)
    if (!s || (s.plugin && !enabled(s.plugin))) { host.toast('That isn’t available right now.', 'warn'); return }
    const state = stateOf(id)
    state.anchor = anchor
    state.ctx = context || {}
    open.add(id)
    if (typeof s.opened === 'function') {
      Promise.resolve().then(() => s.opened(state, full)).catch(error => host.toast(error.message, 'bad')).then(() => host.refresh(id))
    }
    draw(id, true)
  }

  return {
    host,
    ctx: full,
    /** The JR buttons for each game screen, for the game ("a"). */
    anchors () {
      const out = {}
      if (font) out._font = font
      for (const s of surfaces) {
        if (s.plugin && !enabled(s.plugin)) continue
        for (const b of s.buttons || []) {
          const at = out[b.at] || (out[b.at] = Object.assign({ b: [] }, ANCHORS[b.at] || { pos: 'left' }))
          at.b.push(Object.assign({ id: s.id, l: b.label }, b.icon ? { i: b.icon } : {}, b.local ? { local: b.local } : {}))
        }
      }
      return out
    },
    /** The game pressed a JR button. */
    open ({ s, a, x }) { openSurface(String(s), a ? String(a) : null, x && typeof x === 'object' ? x : {}) },
    /** Something happened in a JR window. */
    event ({ p, c, v, i }) {
      const id = String(p)
      const s = byId.get(id)
      if (!s) return
      if (c === '_close') { open.delete(id); if (typeof s.closed === 'function') s.closed(stateOf(id), full); return }
      const state = stateOf(id)
      if (c === '_tab') { state.tab = String(v); draw(id, false); return }
      Promise.resolve()
        .then(() => s.act ? s.act(state, String(c), v == null ? '' : String(v), i && typeof i === 'object' ? i : {}, full) : null)
        .catch(error => host.toast(error && error.message ? error.message : 'That didn’t work.', 'bad'))
        .then(() => { if (open.has(id)) draw(id, false) })
    },
    ids: () => [...byId.keys()],
    /** The game reported its fonts: use its own, if it has one JR knows. */
    fonts (list) {
      const names = (list || []).map(f => String(f).split('/')[0])
      font = PREFERRED_FONTS.map(re => names.find(n => re.test(n))).find(Boolean) || null
      return font
    }
  }
}

module.exports = { createSurfaces, fileStore, ANCHORS }
