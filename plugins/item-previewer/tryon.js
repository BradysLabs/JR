'use strict'

/**
 * Clothing previews: try on any clothing item, on your screen only. JR keeps
 * one of these (application.clothingPreviews) for the Item Previewer window
 * and the Try On window in the game, and remembers what you tried on per
 * account, so it's all back (and back on) the next time you log in.
 *
 * How it works (from real captures):
 *
 *   you send   %xt%o%iu%<room>%<# put on>%<# taken off>%<slots put on...>%<slots taken off...>%
 *   server     %xt%il%-1%3%0%<animal>%<username>%0%<# put on>%<# taken off>%
 *                  <slot>%<item id>% for each item put on, then <slot>% for each taken off
 *   added to inventory (after buying):
 *              %xt%il%-1%2%1%<animal>%<username>%<COLOR>%1%0%<slot>%<item id>%
 *   your whole inventory at login:
 *              %xt%il%-1%0%1%<animal>%<username>%...
 *
 * JR sends the game its own "added" (made-up inventory slot, chosen color)
 * and then an update that puts it on. Nothing goes to the server. When you
 * put a preview on / take it off in the game, the "iu" is cleaned of
 * preview slots and answered here, so the server never sees a slot it
 * doesn't know.
 */

const { noKeep } = require('../../src/game/keep')

// Preview items use slots far above any real inventory slot.
const FAKE_SLOT_BASE = 900000
const REAPPLY_DELAY = 1500   // after changing rooms (your real outfit shows again)
const RESTORE_DELAY = 800    // after login, once the game has your inventory

class ClothingPreviews {
  /**
   * @param {object} o
   * @param {object} o.dispatch
   * @param {() => string|null} o.myName   your username, lower case
   * @param {{load: Function, save: Function}} [o.keep]  where previews are kept
   * @param {(fn: Function, ms: number) => any} [o.later]
   */
  constructor ({ dispatch, myName, keep = noKeep, later = (fn, ms) => setTimeout(fn, ms) }) {
    this.dispatch = dispatch
    this.myName = myName
    this.keep = keep
    this.later = later
    this.me = null              // { animal, username } from your own real "il"
    this.items = new Map()      // slot -> { slot, id, name, colorIndex, colorValue, inventoryNumber, worn }
    this.nextSlot = FAKE_SLOT_BASE
    this.keepOnRoomChange = true
    this.lastOwnWear = 0
    this.listeners = new Set()
    this.owner = null           // whose previews are loaded
    this.restorePending = false
    this.hooks = [
      { type: 'aj', message: 'il', callback: ({ message }) => this._onInventory(message) },
      { type: 'aj', message: 'rj', callback: () => this._onRoom() },
      { type: 'aj', message: 'login', callback: () => this._onLogin() },
      { type: 'connection', message: 'iu', callback: ({ message }) => this._onWear(message) }
    ]
    for (const hook of this.hooks) dispatch.onMessage(hook)
  }

  get ready () { return !!this.me }
  list () { return [...this.items.values()] }

  watch (fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  onChange () { for (const fn of [...this.listeners]) { try { fn() } catch (_) {} } }

  /** Tries an item on. item: { id, name, colorIndex, colorValue, inventoryNumber } */
  add (item) {
    if (!this.me) throw new Error('Put on or take off any item in the game once, so JR can find your animal.')
    const p = { slot: this.nextSlot++, id: Number(item.id), name: item.name || `Item #${item.id}`, colorIndex: Number(item.colorIndex) || 0, colorValue: Number(item.colorValue) | 0, inventoryNumber: item.inventoryNumber || null, worn: true }
    this._addToGame(p)
    this._wearInGame([p])
    this.items.set(p.slot, p)
    this._changed()
    return p
  }

  setWorn (slot, worn) {
    const p = this.items.get(Number(slot))
    if (!p) return
    p.worn = !!worn
    this._wearInGame([p])
    this._changed()
  }

  takeAllOff () {
    const worn = this.list().filter(p => p.worn)
    worn.forEach(p => { p.worn = false })
    if (worn.length) { try { this._wearInGame(worn) } catch (_) {} }
    this._changed()
  }

  /** Stops keeping a preview (takes it off; it leaves your item list when you log in again). */
  remove (slot) {
    const p = this.items.get(Number(slot))
    if (!p) return
    if (p.worn) { p.worn = false; try { this._wearInGame([p]) } catch (_) {} }
    this.items.delete(p.slot)
    this._changed()
  }

  dispose () {
    for (const hook of this.hooks) try { this.dispatch.offMessage(hook) } catch (_) {}
  }

  // ---------------------------------------------------------------- game

  _wearInGame (entries) {
    if (!this.me) throw new Error('Your animal isn’t known yet.')
    const on = entries.filter(e => e.worn)
    const off = entries.filter(e => !e.worn)
    const fields = ['', 'xt', 'il', -1, 3, 0, this.me.animal, this.me.username, 0, on.length, off.length]
    on.forEach(e => fields.push(e.slot, e.id))
    off.forEach(e => fields.push(e.slot))
    this.dispatch.sendConnectionMessage(fields.join('%') + '%')
  }

  _addToGame (e) {
    // Same as a real purchase: the color goes in the header, the item is
    // added "off" and put on with a separate update.
    this.dispatch.sendConnectionMessage(['', 'xt', 'il', -1, 2, 1, this.me.animal, this.me.username, e.colorValue, 1, 0, e.slot, e.id].join('%') + '%')
  }

  // ---------------------------------------------------------------- keeping

  _changed () {
    if (this.owner) this.keep.save(this.owner, this.list().map(({ id, name, colorIndex, colorValue, inventoryNumber, worn }) => ({ id, name, colorIndex, colorValue, inventoryNumber, worn })))
    this.onChange()
  }

  _onLogin () {
    this.me = null
    this.items.clear()
    this.owner = null
    this.restorePending = true
    this.onChange()
  }

  // Your previews from last time: back in your items, and the worn ones back on.
  _restore () {
    this.restorePending = false
    this.owner = this.myName()
    const kept = this.keep.load(this.owner)
    if (!kept.length || !this.me) { this.onChange(); return }
    for (const k of kept) {
      const p = { slot: this.nextSlot++, id: Number(k.id), name: k.name || `Item #${k.id}`, colorIndex: Number(k.colorIndex) || 0, colorValue: Number(k.colorValue) | 0, inventoryNumber: k.inventoryNumber || null, worn: !!k.worn }
      if (!Number.isFinite(p.id)) continue
      this.items.set(p.slot, p)
      try { this._addToGame(p) } catch (_) {}
    }
    const worn = this.list().filter(p => p.worn)
    if (worn.length) { try { this._wearInGame(worn) } catch (_) {} }
    this.onChange()
  }

  // ---------------------------------------------------------------- packets

  // Your own clothing: learn your animal; at login, your previews come back.
  _onInventory (message) {
    const parts = message.value
    if (!Array.isArray(parts) || parts.length < 8) return
    const username = String(parts[7] || '').toLowerCase()
    const loginName = this.myName()
    const mine = (loginName && username === loginName) || Date.now() - this.lastOwnWear < 3000
    if (!mine) return
    const fresh = !this.me || this.me.animal !== parts[6]
    this.me = { animal: parts[6], username: parts[7] }
    if (!this.owner && loginName) this.owner = loginName
    if (this.restorePending || (fresh && !this.items.size && this.owner && this.keep.load(this.owner).length && !this._restored)) {
      this._restored = true
      this.later(() => this._restore(), RESTORE_DELAY)
    } else if (fresh) this.onChange()
  }

  // Changing rooms shows your real outfit again; put previews back on.
  _onRoom () {
    if (!this.keepOnRoomChange) return
    const worn = this.list().filter(p => p.worn)
    if (!worn.length) return
    this.later(() => { try { this._wearInGame(worn) } catch (_) {} }, REAPPLY_DELAY)
  }

  // Putting on / taking off. Preview slots are handled here; real ones go to the server.
  //   %xt%o%iu%<room>%<# put on>%<# taken off>%<slots put on...>%<slots taken off...>%
  _onWear (message) {
    const parts = message.value
    if (!Array.isArray(parts)) return
    const end = parts[parts.length - 1] === '' ? parts.length - 1 : parts.length
    const onCount = parseInt(parts[5], 10) || 0
    const offCount = parseInt(parts[6], 10) || 0
    const putOn = parts.slice(7, 7 + onCount).map(Number)
    const takenOff = parts.slice(7 + onCount, Math.min(end, 7 + onCount + offCount)).map(Number)
    const isPreview = slot => this.items.has(slot)
    if (!putOn.concat(takenOff).some(isPreview)) { this.lastOwnWear = Date.now(); return }
    const changed = []
    putOn.filter(isPreview).forEach(slot => { const p = this.items.get(slot); p.worn = true; changed.push(p) })
    takenOff.filter(isPreview).forEach(slot => { const p = this.items.get(slot); p.worn = false; changed.push(p) })
    try { this._wearInGame(changed) } catch (_) {}
    const realOn = putOn.filter(slot => !isPreview(slot))
    const realOff = takenOff.filter(slot => !isPreview(slot))
    if (realOn.length || realOff.length) {
      message.value = [...parts.slice(0, 5), realOn.length, realOff.length, ...realOn, ...realOff, '']
      this.lastOwnWear = Date.now()
    } else {
      message.send = false
      this.dispatch.sendConnectionMessage(`%xt%iu%${parts[4]}%1%`)
    }
    this._changed()
  }
}

module.exports = { ClothingPreviews, FAKE_SLOT_BASE }
