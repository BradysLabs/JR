'use strict'

/**
 * Bulk Buy, by BradysLabs: repeats the last thing you bought in the game.
 *
 * Clothing: %xt%o%ib%<room>%<shop>%1%<item>%<color choice>%...   answer %xt%ib%<room>%<1 ok>%<shop>%<balance>%
 * Den items: %xt%o%db%<room>%-1%<list>%<item>%...               answer %xt%db%-1%<1 ok>%<balance>%
 * (List 384 is dens themselves; those need a free den slot, so they're left to the Den Shop.)
 *
 * Repeating the exact packet keeps the color you picked in the shop.
 */

const DEN_LIST = '384'
const MAX = 100
const GAP = 500
const REPLY_TIMEOUT = 6000

/** A purchase the game sent, or null if it isn't one Bulk Buy can repeat. */
function readPurchase (raw) {
  const parts = String(raw || '').split('%')
  const cmd = parts[3]
  if (parts[1] !== 'xt' || parts[2] !== 'o' || (cmd !== 'ib' && cmd !== 'db')) return null
  if (cmd === 'db' && parts[6] === DEN_LIST) return null
  const defId = Number(parts[7])
  if (!(defId > 0)) return null
  return { cmd, kind: cmd === 'ib' ? 'clothing' : 'den', defId, parts }
}

/** The purchase again, in the room you're in now. */
function packetFor (purchase, room) {
  const parts = purchase.parts.slice()
  parts[4] = String(room)
  return parts.join('%')
}

/** The answer to a purchase: { ok, balance }. */
function readReply (cmd, value) {
  const v = (value || []).map(String)
  if (v[2] !== cmd) return null
  return { ok: v[4] === '1', balance: cmd === 'ib' ? v[6] : v[5] }
}

class BulkBuyer {
  constructor ({ dispatch, wait, onChange }) {
    this.dispatch = dispatch
    this.wait = wait || ((ms) => new Promise(resolve => setTimeout(resolve, ms)))
    this.onChange = onChange || (() => {})
    this.last = null
    this.run = null
    this.pending = null // resolve for JR's own purchase
    this.hooks = [
      { type: 'connection', message: 'ib', callback: ({ message }) => this._seen(message) },
      { type: 'connection', message: 'db', callback: ({ message }) => this._seen(message) },
      { type: 'aj', message: 'ib', callback: ({ message }) => this._answer('ib', message) },
      { type: 'aj', message: 'db', callback: ({ message }) => this._answer('db', message) }
    ]
    for (const h of this.hooks) dispatch.onMessage(h)
  }

  _seen (message) {
    if (this.run) return
    const raw = typeof message.toMessage === 'function' ? message.toMessage() : message.raw
    const p = readPurchase(raw)
    if (p) { this.last = p; this.onChange() }
  }

  _answer (cmd, message) {
    if (!this.pending || this.pending.cmd !== cmd) return
    const r = readReply(cmd, message.value)
    if (!r) return
    // JR asked, not the game: keep the answer from the game so it doesn't
    // pop up its own purchase messages (or put each one on).
    message.send = false
    const resolve = this.pending.resolve
    this.pending = null
    resolve(r)
  }

  /** Buys the last purchase `count` more times. Stops at the first refusal. */
  async buy (count) {
    const p = this.last
    if (!p) throw new Error('Buy one in Animal Jam first, so JR knows what to buy.')
    if (this.run) throw new Error('Already buying.')
    const n = Math.max(1, Math.min(MAX, Math.floor(Number(count) || 0)))
    const run = { total: n, done: 0, stopped: false, balance: null, refused: false }
    this.run = run
    this.onChange()
    try {
      for (let i = 0; i < n && !run.stopped; i++) {
        const room = this.dispatch.getState('room')
        if (!room) throw new Error('Join a room in Animal Jam first.')
        const answer = new Promise(resolve => {
          this.pending = { cmd: p.cmd, resolve }
          setTimeout(() => { if (this.pending && this.pending.resolve === resolve) { this.pending = null; resolve(null) } }, REPLY_TIMEOUT)
        })
        await this.dispatch.sendRemoteMessage(packetFor(p, room))
        const r = await answer
        if (!r) throw new Error(`No answer from the game after ${run.done} bought. Check your inventory.`)
        if (!r.ok) { run.refused = true; break }
        run.done++
        run.balance = r.balance
        this.onChange()
        if (i < n - 1) await this.wait(GAP)
      }
      return { ...run }
    } finally {
      this.pending = null
      this.run = null
      this.onChange()
    }
  }

  stop () { if (this.run) this.run.stopped = true }

  dispose () {
    this.stop()
    for (const h of this.hooks) { try { this.dispatch.offMessage(h) } catch (_) {} }
  }
}

module.exports = { BulkBuyer, readPurchase, packetFor, readReply, MAX }
