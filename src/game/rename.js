'use strict'

/**
 * Incognito (Streaming Mode): the game is told your username is your
 * Display Name, so every place it shows your name shows that instead.
 *
 * JR swaps your username for the Display Name in everything Animal Jam sends
 * to the game, and swaps it back in everything the game sends to Animal Jam.
 * Only your screen changes; other players still see your real username.
 *
 * The swap is fixed when you log in. Changes after that show right away in
 * the game's name tags and player cards (through JR's in-game build), and
 * everywhere at the next login.
 */

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Display Names can only use letters, numbers, spaces, _ and . */
function cleanName (text) {
  return String(text || '').replace(/[^A-Za-z0-9 _.]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20)
}

/** A function that swaps whole-word `from` (and "den" + from) for `to`. */
function swapper (from, to) {
  const re = new RegExp(`(?<![A-Za-z0-9])(den)?${escape(from)}(?![A-Za-z0-9])`, 'gi')
  return (text) => text.replace(re, (_, den) => (den || '') + to)
}

/**
 * Applies fn to every string in a packet value (arrays, objects and their
 * keys). Returns a copy, so objects JR keeps (like your login details) are
 * never changed.
 */
function walk (value, fn) {
  if (typeof value === 'string') return fn(value)
  if (Array.isArray(value)) return value.map(v => walk(v, fn))
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) out[fn(key)] = walk(value[key], fn)
    return out
  }
  return value
}

/**
 * @param {object} o
 * @param {import('../engine/dispatch').Dispatch} o.dispatch
 * @param {() => string} o.alias the saved Display Name
 * @param {(e: {type: string, message: string}) => void} [o.log]
 */
function createIncognito ({ dispatch, alias, log = () => {} }) {
  let session = null // { real, alias, toGame, toServer }

  dispatch.on('disconnected', () => { session = null })

  // Login answer: decide for this session. Runs after JR's own login hook
  // (which records your real username), before the game sees the answer.
  // The swap stays fixed until you log out: a game that suddenly saw a new
  // name for itself would treat you as a stranger in your own room.
  dispatch.onMessage({
    type: 'aj',
    message: 'login',
    callback: ({ message }) => {
      const o = message.value && message.value.b && message.value.b.o
      const real = o && o.params && o.params.userName
      const name = cleanName(alias())
      session = null
      if (!real || !name || name.toLowerCase() === String(real).toLowerCase()) return
      session = { real: String(real), alias: name, toGame: swapper(String(real), name), toServer: swapper(name, String(real)) }
      log({ type: 'notify', message: 'Incognito: the game shows your Display Name instead of your username this session.' })
    }
  })

  dispatch.onMessage({
    type: '*',
    callback: ({ message }) => {
      if (!session || message.format === 'text') return
      // The game's outgoing XML is its login and chat: chat is sent as typed,
      // and the server is picky about how XML is written, so it's left alone.
      if (message.direction === 'out' && message.format === 'xml') return
      const fn = message.direction === 'in' ? session.toGame : session.toServer
      message.value = walk(message.value, fn)
    }
  })

  return {
    /** Names the game may know you by this session: [username, Incognito name]. */
    ids () {
      const real = (dispatch.getState('player') || {}).userName
      return [real, session && session.alias].filter(Boolean).map(String)
    },
    get session () { return session }
  }
}

module.exports = { createIncognito, cleanName, swapper, walk }
