'use strict'

/**
 * Gem Farm, by BradysLabs: the farming loop, separate from the window so it
 * can be tested.
 *
 * It opens adventure #49 once, then repeats three packets: reach goal 4,
 * and take each of its two gift prizes. Prize items that arrive can be
 * recycled straight away for gems.
 */

const QUEST = 49
const LOOP = [
  (room) => `%xt%o%qat%${room}%gui_goal4%0%`,
  (room) => `%xt%o%qpgiftplr%${room}%0%0%0%`,
  (room) => `%xt%o%qpgiftplr%${room}%1%0%0%`
]
// The prize items adventure #49 gives (clothing IDs).
const PRIZE_ITEMS = [857, 860, 861, 862, 863, 864, 865, 866, 867, 868, 869, 870]
const MIN_DELAY = 250

class GemFarm {
  /**
   * @param {object} options
   * @param {object} options.dispatch JR's dispatch
   * @param {(ms: number) => Promise<void>} [options.wait]
   * @param {(event: object) => void} [options.onChange] called after anything changes
   */
  constructor ({ dispatch, wait, onChange }) {
    this.dispatch = dispatch
    this.wait = wait || ((ms) => new Promise(resolve => { this._timer = setTimeout(resolve, ms) }))
    this.onChange = onChange || (() => {})
    this.running = false
    this.recycle = true
    this.delay = 500
    this.recycleIds = new Set(PRIZE_ITEMS)
    this.stats = { cycles: 0, recycled: 0, startedAt: null }
    this.lastError = null
    this._hook = { type: 'aj', message: 'il', callback: ({ message }) => this._onItem(message.value) }
    dispatch.onMessage(this._hook)
  }

  _room () {
    const room = this.dispatch.getState('room')
    return room == null || room === '' ? null : String(room)
  }

  /** Starts farming. Resolves when it stops. */
  async start ({ delay, recycle } = {}) {
    if (this.running) return
    const room = this._room()
    if (!room) throw new Error('Join a room in Animal Jam first.')
    if (delay != null) this.delay = Math.max(MIN_DELAY, Number(delay) || 500)
    if (recycle != null) this.recycle = !!recycle
    this.running = true
    this.lastError = null
    this.stats = { cycles: 0, recycled: 0, startedAt: Date.now() }
    this.onChange()
    try {
      await this.dispatch.sendRemoteMessage(`%xt%o%qj%${room}%Z%${QUEST}%0%0%`)
      await this.wait(this.delay)
      while (this.running) {
        const r = this._room()
        if (!r) throw new Error('Left the room. Gem Farm stopped.')
        for (const packet of LOOP) {
          if (!this.running) break
          await this.dispatch.sendRemoteMessage(packet(r))
          await this.wait(this.delay)
        }
        if (this.running) { this.stats.cycles++; this.onChange() }
      }
    } catch (error) {
      this.lastError = error.message
      throw error
    } finally {
      this.running = false
      this.onChange()
    }
  }

  stop () {
    this.running = false
    if (this._timer) clearTimeout(this._timer)
    this.onChange()
  }

  /** A single item added: %xt%il%-1%...  14 fields, slot at 11 and item at 12. */
  _onItem (v) {
    if (!this.running || !this.recycle || !Array.isArray(v) || v.length !== 14) return
    const slot = v[11]
    const id = Number(v[12])
    if (!this.recycleIds.has(id) || !/^\d+$/.test(String(slot))) return
    const room = this._room()
    if (!room) return
    Promise.resolve(this.dispatch.sendRemoteMessage(`%xt%o%ir%${room}%${slot}%`))
      .then(() => { this.stats.recycled++; this.onChange() })
      .catch(() => {})
  }

  dispose () {
    this.stop()
    try { this.dispatch.offMessage(this._hook) } catch (_) {}
  }
}

module.exports = { GemFarm, PRIZE_ITEMS, QUEST, MIN_DELAY }
