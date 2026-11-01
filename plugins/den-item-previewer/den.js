'use strict'

/**
 * Den item previews: any den item in your own den, on your screen only.
 * Nothing about them is sent to Animal Jam.
 *
 * With JR's in-game build, JR asks the game itself ("dp", JRDenPreview in
 * tools/game-mod/as/JRUI.as) to put a preview in your den inventory (the
 * editor's bottom bar) and in your den, the way the editor places an item you
 * click. Nothing else in your den moves. You can then drag it around, put it
 * back in the bar and so on, like any item.
 *
 * Messages JR changes (from the game's own code):
 *
 * Your den, from the server (den/DenXtCommManager.as, denStateResponse):
 *   %xt%ds%<room>%<item count>%<pet count>%<force reload>%  then per item
 *     <slot>%<item id>%<placed 1>%<x>%<y>%<version>%<flipped>%null%<text>%<number>%<text>%
 *     (mannequins: 10 more fields, see BARE_MANNEQUIN) %<eco state>%
 *   then the den's pets. Previews in your den are added, where you left them.
 *
 * Your den inventory (denItemsResponse):
 *   %xt%di%<room>%<den>%<item count>%<pets in den>%  then per item
 *     <slot>%<item id>%<placed>%<version>%true%<text>%<number>%<text>%
 *     (mannequins: 10 more fields) %<eco state>%
 *   Every preview is added, so it stays in the bottom bar.
 *
 * Saving den changes (requestDenStateChange, sent when you're done editing):
 *   %xt%o%ds%<room>%<count>%[sometimes one more field]%  then per changed item 17 fields:
 *     <ref>%<slot>%<placed 1/0>%<x>%<y>%<flipped>%<name link>%<10 mannequin fields>
 *   (from real saves: placing gives 0%0%<slot>%1%..., taking back 0%<slot>%0%...;
 *   any extra fields come right after the count and are kept as they are)
 *   JR notes where you put each preview and takes them out before the save
 *   goes to the server; your real changes still go through. The server's
 *   answer (%xt%dss%-1%<saved slots>%) gets the previews' slots added, so
 *   the game marks them placed like the rest.
 *
 * Anything else that names a preview slot is kept from the server.
 *
 * Previews are kept per account in your JR profile (src/game/keep.js), where
 * you left them, so they're back in your den and den items the next time you
 * log in.
 */

const { noKeep } = require('../../src/game/keep')

const FAKE_SLOT_BASE = 1900000000
const MANNEQUIN = 4
// A mannequin's extra fields (avatar/MannequinData.as): its look (base color,
// pattern color, pattern, eye color, eyes) and its five clothing slots.
// All 0: the game's default look, wearing nothing.
const BARE_MANNEQUIN = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
const SAVE_FIELDS = 17
const DEFAULT_SPOT = { x: 900, y: 560 }

/** One den record for a placed preview. */
function previewRecord (p) {
  return [p.slot, p.defId, 1, Math.round(p.x), Math.round(p.y), p.version || 0, p.flipped ? 1 : 0, 'null', '', 0, '', ...(p.mannequin ? BARE_MANNEQUIN : []), 0]
}

/** One den inventory record for a preview. */
function inventoryRecord (p) {
  return [p.slot, p.defId, p.placed ? 1 : 0, p.version || 0, 'true', '', -1, '', ...(p.mannequin ? BARE_MANNEQUIN : []), 0]
}

/**
 * The "ds" fields with these previews added to the front (a new array; the
 * original is left alone). Null if it isn't a den.
 */
function withPreviews (value, previews, { force = false } = {}) {
  if (!Array.isArray(value) || value[2] !== 'ds' || !/^\d+$/.test(String(value[4]))) return null
  const records = previews.flatMap(previewRecord)
  return [...value.slice(0, 4), Number(value[4]) + previews.length, value[5], force ? '1' : value[6], ...records, ...value.slice(7)]
}

/** The "di" fields with these previews added to the front. Null if it isn't one. */
function withInventoryPreviews (value, previews) {
  if (!Array.isArray(value) || value[2] !== 'di' || !/^\d+$/.test(String(value[5]))) return null
  const records = previews.flatMap(inventoryRecord)
  return [...value.slice(0, 5), Number(value[5]) + previews.length, value[6], ...records, ...value.slice(7)]
}

/**
 * A den save split into the preview changes and the rest. Returns
 * { value, changes } (changes: [{slot, placed, x, y, flipped}]), or null when
 * nothing in it is a preview.
 */
function splitPreviewChanges (value, slots) {
  if (!Array.isArray(value) || value[3] !== 'ds' || !/^\d+$/.test(String(value[5]))) return null
  const count = Number(value[5])
  const end = value[value.length - 1] === '' ? value.length - 1 : value.length
  // The items are the last count * 17 fields; anything between the count and them is kept.
  const start = end - count * SAVE_FIELDS
  if (count < 1 || start < 6) return null
  const kept = []
  const changes = []
  for (let n = 0; n < count; n++) {
    const e = value.slice(start + n * SAVE_FIELDS, start + (n + 1) * SAVE_FIELDS)
    if (slots.has(String(e[1]))) changes.push({ slot: Number(e[1]), placed: String(e[2]) !== '0', x: Number(e[3]), y: Number(e[4]), flipped: String(e[5]) === '1' || String(e[5]) === 'true' })
    else kept.push(...e)
  }
  if (!changes.length) return null
  return { value: [...value.slice(0, 5), count - changes.length, ...value.slice(6, start), ...kept, ...value.slice(end)], changes }
}

/** For older callers and tests: the save without the preview changes. */
function withoutPreviewChanges (value, slots) {
  const split = splitPreviewChanges(value, slots)
  return split ? split.value : null
}

/** Whether a message from the game names one of these preview slots. */
function mentionsSlot (value, slots) {
  if (!Array.isArray(value) || !slots.size) return false
  for (let i = 4; i < value.length; i++) if (slots.has(String(value[i]))) return true
  return false
}

class DenPreviews {
  /**
   * @param {object} o
   * @param {object} o.dispatch       JR's dispatch
   * @param {(id) => object|null} o.getDenItem
   * @param {() => string|null} o.myName  your username, lower case
   * @param {(room: string, name: string) => string} o.joinPacket
   * @param {{send: (kind: string, value: object) => void, ready: () => boolean}} [o.game]
   *   JR's in-game build, when the game has it
   * @param {() => void} [o.onChange]
   *
   * JR keeps one of these for everyone (application.denPreviews), so the
   * Den Item Previewer window and JR's window in the game show the same
   * previews. Each listens with watch().
   */
  constructor ({ dispatch, getDenItem, myName, joinPacket, game = null, keep = noKeep, onChange }) {
    this.dispatch = dispatch
    this.keep = keep
    this.owner = null       // whose previews are loaded
    this.getDenItem = getDenItem
    this.myName = myName
    this.joinPacket = joinPacket
    this.game = game
    this.listeners = new Set()
    if (onChange) this.listeners.add(onChange)
    this.items = new Map() // slot -> { slot, defId, name, version, mannequin, placed, x, y, flipped }
    this.nextSlot = FAKE_SLOT_BASE
    this.spot = null        // where you last walked in your den
    this.savedSlots = []    // previews taken out of the last save, for its answer
    this.hooks = [
      { type: 'aj', message: 'ds', callback: ({ message }) => this._onDen(message) },
      { type: 'aj', message: 'di', callback: ({ message }) => this._onInventory(message) },
      { type: 'aj', message: 'dss', callback: ({ message }) => this._onSaved(message) },
      // A new login: that account's kept previews.
      { type: 'aj', message: 'login', callback: () => this._onLogin() },
      { type: 'connection', message: 'au', callback: ({ message }) => this._onWalk(message) },
      { type: 'connection', message: 'ds', callback: ({ message }) => this._onSave(message) },
      { type: 'connection', message: '*', callback: ({ message }) => this._guard(message) }
    ]
    for (const hook of this.hooks) dispatch.onMessage(hook)
  }

  /** "den<you>" when you're in your own den, else null. */
  ownDen () {
    const name = this.myName()
    const room = String(this.dispatch.getState('roomName') || '')
    return name && room.toLowerCase() === `den${name}` ? room : null
  }

  list () { this._load(); return [...this.items.values()] }

  /** Calls fn whenever the previews change. Returns a function that stops it. */
  watch (fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  onChange () {
    if (this.owner) {
      this.keep.save(this.owner, this.list().map(({ defId, name, version, mannequin, placed, x, y, flipped }) => ({ defId, name, version, mannequin, placed, x, y, flipped })))
    }
    for (const fn of [...this.listeners]) { try { fn() } catch (_) {} }
  }

  // The account's kept previews, once JR knows who you are.
  _load () {
    const name = this.myName()
    if (!name || this.owner === name) return
    this.owner = name
    this.items.clear()
    for (const k of this.keep.load(name)) {
      if (!this.getDenItem(k.defId)) continue
      const p = { slot: this.nextSlot++, defId: Number(k.defId), name: k.name || `Den item #${k.defId}`, mannequin: !!k.mannequin, version: Number(k.version) || 0, placed: k.placed !== false, x: k.x == null ? null : Number(k.x), y: k.y == null ? null : Number(k.y), flipped: !!k.flipped }
      this.items.set(p.slot, p)
    }
    for (const fn of [...this.listeners]) { try { fn() } catch (_) {} }
  }

  _onLogin () {
    this.savedSlots = []
    this.owner = null
    this.items.clear()
    this._load()
    for (const fn of [...this.listeners]) { try { fn() } catch (_) {} }
  }

  _gameReady () { return !!(this.game && this.game.ready()) }

  /**
   * Adds a den item to your den inventory and your den (on your screen).
   * Resolves with { preview, shown }: shown is 'den' (it's in your den now),
   * 'bar' (in your den items; not in your den right now) or 'later' (it shows
   * next time you go into your den).
   */
  async place (defId, { version = 0 } = {}) {
    const def = this.getDenItem(defId)
    if (!def) throw new Error('That isn’t a den item.')
    if (!this.myName()) throw new Error('Log in to Animal Jam first.')
    this._load()
    const p = { slot: this.nextSlot++, defId: Number(defId), name: def.name || `Den item #${defId}`, mannequin: Number(def.specialType) === MANNEQUIN, version: Math.max(0, Number(version) || 0), placed: true, x: null, y: null, flipped: false }
    this.items.set(p.slot, p)
    this.onChange()
    let shown = 'later'
    const inDen = !!this.ownDen()
    if (this._gameReady()) {
      this.game.send('dp', { op: 'add', s: p.slot, d: p.defId, v: p.version, place: inDen })
      shown = inDen ? 'den' : 'bar'
    } else if (inDen) {
      // No in-game build: going back into your den shows it (from "ds").
      await this._rejoin()
      shown = 'den'
    }
    return { preview: p, shown }
  }

  /** Takes a preview out of your den and your den items. */
  async remove (slot) {
    slot = Number(slot)
    if (!this.items.delete(slot)) return
    this.onChange()
    if (this._gameReady()) this.game.send('dp', { op: 'remove', s: slot })
    else if (this.ownDen()) await this._rejoin()
  }

  /** Takes every preview out. False if there were none. */
  async clear () {
    if (!this.items.size) return false
    const slots = [...this.items.keys()]
    this.items.clear()
    this.onChange()
    if (this._gameReady()) for (const s of slots) this.game.send('dp', { op: 'remove', s })
    else if (this.ownDen()) await this._rejoin()
    return true
  }

  async _rejoin () {
    const den = this.ownDen()
    if (!den) return false
    await this.dispatch.sendRemoteMessage(this.joinPacket(this.dispatch.getState('room'), den))
    return true
  }

  dispose () {
    for (const hook of this.hooks) try { this.dispatch.offMessage(hook) } catch (_) {}
  }

  // Your den from the server: add the placed previews where you left them.
  _onDen (message) {
    this._load()
    if (message.fromPlugin || !this.items.size || !this.ownDen()) return
    const spot = this.spot || DEFAULT_SPOT
    let n = 0
    const placed = this.list().filter(p => p.placed).map(p => {
      if (p.x == null || p.y == null) { p.x = spot.x + (n % 4) * 60; p.y = spot.y + Math.floor(n / 4) * 40; n++ }
      return p
    })
    if (!placed.length) return
    const out = withPreviews(message.value, placed)
    if (out) message.value = out
  }

  // Your den items from the server: keep the previews in the bar.
  _onInventory (message) {
    this._load()
    if (message.fromPlugin || !this.items.size) return
    const out = withInventoryPreviews(message.value, this.list())
    if (out) message.value = out
  }

  // The server saved your den changes: the previews were saved too, as far as the game knows.
  _onSaved (message) {
    if (!this.savedSlots.length) return
    const v = Array.isArray(message.value) ? message.value : null
    if (v && v[2] === 'dss') {
      const end = v[v.length - 1] === '' ? v.length - 1 : v.length
      message.value = [...v.slice(0, end), ...this.savedSlots, '']
    }
    this.savedSlots = []
  }

  // %xt%o%au%<room>%1%<x>%<y>%<dir>%0%
  _onWalk (message) {
    if (!this.ownDen()) return
    const v = message.value
    const x = Number(v && v[6]); const y = Number(v && v[7])
    if (Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0) this.spot = { x, y }
  }

  // Saving den changes: note where previews went; the server only hears about real items.
  _onSave (message) {
    if (!this.items.size) return
    const slots = this._slots()
    const split = splitPreviewChanges(message.value, slots)
    if (!split) {
      // A save JR can't read that names a preview: never let it reach the
      // server. The game gets its answer from JR so it doesn't wait.
      if (mentionsSlot(message.value, slots)) {
        message.send = false
        const named = [...slots].filter(s => message.value.map(String).includes(s))
        try { this.dispatch.sendConnectionMessage(`%xt%dss%-1%${named.join('%')}%`) } catch (_) {}
      }
      return
    }
    for (const c of split.changes) {
      const p = this.items.get(c.slot)
      if (!p) continue
      p.placed = c.placed
      if (c.placed) { p.x = c.x; p.y = c.y; p.flipped = c.flipped }
    }
    this.onChange()
    const saved = split.changes.map(c => c.slot)
    if (Number(split.value[5]) > 0) {
      this.savedSlots = saved
      message.value = split.value
    } else {
      // Only previews changed: nothing for the server. Answer the game here.
      message.send = false
      this.savedSlots = []
      try { this.dispatch.sendConnectionMessage(`%xt%dss%-1%${saved.join('%')}%`) } catch (_) {}
    }
  }

  // Never let the server hear about a preview slot.
  _guard (message) {
    if (!this.items.size || message.send === false) return
    const v = message.value
    if (Array.isArray(v) && v[3] === 'ds') return // handled in _onSave
    if (mentionsSlot(v, this._slots())) message.send = false
  }

  _slots () { return new Set([...this.items.keys()].map(String)) }
}

module.exports = { DenPreviews, withPreviews, withInventoryPreviews, withoutPreviewChanges, splitPreviewChanges, previewRecord, inventoryRecord, mentionsSlot, FAKE_SLOT_BASE }
