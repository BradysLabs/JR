'use strict'

/**
 * JR's link to its in-game build of Animal Jam (see tools/game-mod).
 *
 * The game and JR talk over the game's own connection, through JR's proxy:
 *
 *   game -> JR   %xt%o%jr%<room>%<kind>%<args...>%   kept by JR, never sent to Animal Jam
 *   JR -> game   %xt%jr%-1%<kind>%<json>%            sent only to your own game
 *
 * Kinds the game sends:
 *   s                      send me the Settings rows
 *   t <key> <0|1>          a JR row in the game's Settings was switched
 *   a <key>                a JR button in the game's Settings was pressed
 *   w <key> <c|d> <defId> <color> <name>   worth for the item being hovered
 *   n <name>               new Display Name ("-" clears it)
 *   o {s, a, x}            a JR button on a game screen was pressed: surface s,
 *                          screen a, what the screen knows x (src/game/surfaces)
 *   u {p, c, v, i}         something in JR window p: control c, value v, typed text i
 *   d {what, ...}          how a game screen is laid out (logged), and the game's fonts
 *   k                      worth of your items, for the Most valuable sort (answered with k)
 *
 * Kinds JR sends:
 *   s [rows]               rows for the game's Settings window
 *   w {k, t, b[]}          worth bubble text for hover key k ({k, off: 1} hides it)
 *   c {}                   forget cached worth (after a setting change)
 *   a {screen: {pos, dx, dy, b: [{id, l}]}}   JR buttons for each game screen
 *   v {id, title, rows, ...}  show or update a JR window (open: true to open it)
 *   x {id}                 close a JR window
 *   m {text, c}            a short message at the top of the game
 *   p {name, saved}        Display Name to show in place of your username
 *                          (empty when off), and the saved one for the edit box
 */

const { xtIn } = require('../engine/codec')

/** JSON the game can read inside one %-separated field. */
function field (value) {
  return JSON.stringify(value).replace(/%/g, '\\u0025')
}

const num = (n) => n >= 100 ? (Math.round(n / 5) * 5).toLocaleString('en-US') : n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10)
const SCOPE = { color: 'This color', 'all colors': 'Range across all colors', 'all versions': 'Range across all versions' }

/** Bubble text for one worth lookup result. */
function worthText (key, r) {
  if (!r || !r.found) return { k: key, off: 1 }
  const lines = []
  const sub = [r.color, SCOPE[r.scope]].filter(Boolean).join(' · ')
  if (sub) lines.push(sub)
  if (!r.matched) {
    lines.push('Not on the Item Worth Wiki.')
  } else {
    if (r.diamonds) {
      const a = num(r.diamonds.min)
      const b = num(r.diamonds.max)
      lines.push(`≈ ${a === b ? a : `${a}–${b}`} Diamonds`)
      if (r.bl >= 0.1) lines.push(`≈ ${r.bl >= 10 ? Math.round(r.bl) : Math.round(r.bl * 10) / 10} Black Long collars`)
    }
    for (const line of r.lines || []) lines.push(`• ${line}`)
    if (r.more) lines.push(`+${r.more} more on the wiki`)
  }
  lines.push(`Item Worth Wiki${r.updated ? ` · ${r.updated}` : ''} · JR`)
  return { k: key, t: r.name, b: lines }
}

/**
 * @param {object} o
 * @param {import('../engine/dispatch')} o.dispatch
 * @param {() => Array<{k: string, l: string, f: string, v?: boolean, y?: 'b', b?: string}>} o.rows
 * @param {(key: string, value: boolean) => void} o.toggle
 * @param {(key: string) => void} o.press
 * @param {(q: {kind: string, defId: number, color: number, name: string}) => Promise<object>} o.worth
 * @param {(e: {type: string, message: string}) => void} [o.log]
 */
function createGameBridge ({ dispatch, rows, toggle, press, worth, profile = () => ({ name: '', saved: '' }), rename = () => {}, anchors = () => ({}), surfaces = null, report = () => {}, worthMap = () => ({}), picture = () => {}, log = () => {} }) {
  let seen = false
  let talking = false // the game on this connection has JR's in-game build
  let lastAnchors = ''
  const send = (kind, value) => {
    try { dispatch.sendConnectionMessage(xtIn('jr', -1, kind, field(value))) } catch (_) {}
  }
  const reportFailure = (prefix, error) => {
    const message = `${prefix}: ${error && error.message}`
    log({ type: 'warn', message })
    try { dispatch.serverMessage(`JR · ${error && error.message ? error.message : 'Action failed.'}`) } catch (_) {}
  }
  // The JR buttons for each game screen, only when they change: the game
  // rebuilds every button row it has when they arrive.
  const sendAnchors = (force) => {
    const a = anchors()
    const text = JSON.stringify(a)
    if (!force && text === lastAnchors) return
    lastAnchors = text
    send('a', a)
  }
  const sendRows = () => { send('s', rows()); send('p', profile()); sendAnchors(false) }

  dispatch.onMessage({
    type: 'connection',
    message: 'jr',
    callback: ({ message }) => {
      // Never forward JR's own messages to Animal Jam.
      message.send = false
      const parts = Array.isArray(message.value) ? message.value : []
      const args = parts.slice(5, parts[parts.length - 1] === '' ? -1 : undefined)
      const kind = args[0]
      if (!seen) { seen = true; log({ type: 'success', message: 'JR’s in-game build is talking to JR.' }) }
      talking = true
      try {
        if (kind === 's') sendRows()
        else if (kind === 't') {
          Promise.resolve(toggle(String(args[1]), args[2] === '1'))
            .then(() => { sendRows(); send('c', {}) })
            .catch(error => reportFailure('In-game setting failed', error))
        } else if (kind === 'a') {
          Promise.resolve(press(String(args[1])))
            .then(sendRows)
            .catch(error => reportFailure('In-game action failed', error))
        }
        else if (kind === 'n') { rename(args[1] === '-' ? '' : String(args[1] || '')); sendRows() }
        else if (kind === 'o' && surfaces) surfaces.open(JSON.parse(String(args[1] || '{}')))
        else if (kind === 'k') send('k', worthMap())
        // An item picture the game drew (src/game/pictures.js).
        else if (kind === 'i') picture(String(args[1] || ''), String(args[2] || ''), String(args[3] || ''))
        else if (kind === 'd') {
          // What the game reports about its own screens, for placing JR's buttons.
          const info = JSON.parse(String(args[1] || '{}'))
          try { report(info) } catch (_) {}
          log({ type: 'debug', message: `In-game layout: ${JSON.stringify(info).slice(0, 1500)}` })
          if (Array.isArray(info.fonts) && surfaces && surfaces.fonts) {
            const font = surfaces.fonts(info.fonts)
            log({ type: 'debug', message: `Game fonts: ${info.fonts.join(', ')}${font ? ` (JR uses ${font})` : ''}` })
            sendAnchors(true)
          }
        }
        else if (kind === 'u' && surfaces) surfaces.event(JSON.parse(String(args[1] || '{}')))
        else if (kind === 'w') {
          // Answered in the background, so the game's other messages never wait.
          const key = String(args[1] || '')
          Promise.resolve(worth({ kind: args[2] === 'd' ? 'den' : 'clothing', defId: Number(args[3]), color: Number(args[4]), name: String(args[5] || '') }))
            .then(result => send('w', worthText(key, result)))
            .catch(error => log({ type: 'warn', message: `Worth bubble: ${error && error.message}` }))
        }
      } catch (error) {
        reportFailure('In-game JR request failed', error)
      }
    }
  })

  // Give the game its Settings rows whenever it joins a room, so they're
  // ready before the Settings window is first opened.
  dispatch.onMessage({ type: 'aj', message: 'rj', callback: () => { setTimeout(sendRows, 0) } })
  // A new login starts a new game: send the screen buttons again.
  dispatch.onMessage({ type: 'aj', message: 'login', callback: () => { lastAnchors = ''; talking = false } })

  return { sendRows, send, sendAnchors, setSurfaces (s) { surfaces = s }, get talking () { return talking } }
}

module.exports = { createGameBridge, worthText, field }
