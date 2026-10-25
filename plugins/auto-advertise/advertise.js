'use strict'

/**
 * Auto Advertise, by BradysLabs: says your messages in room chat on a timer.
 *
 * Chat, exactly as the game sends it (from a real capture):
 *   <msg t='sys'><body action='pubMsg' r='<room>'><txt><![CDATA[<text>%9]]></txt></body></msg>
 * The server says it back to everyone in the room, you included:
 *   %xt%uc%<room>%<your id>%<text>%9%0%
 *
 * Sending the same lines over and over is what gets accounts muted, so the
 * gap is never under 30 seconds and is a little random each time.
 */

const MIN_GAP = 30 // seconds
const CONFIRM_WITHIN = 5000 // ms for the server to say a message back
const MAX_LENGTH = 100

function chatPacket (room, text) {
  if (!room) throw new Error('Join a room in Animal Jam first.')
  const clean = cleanMessage(text)
  if (!clean) throw new Error('That message is empty.')
  return `<msg t='sys'><body action='pubMsg' r='${room}'><txt><![CDATA[${clean}%9]]></txt></body></msg>`
}

/** One line, no characters that would break the chat packet, not too long. */
function cleanMessage (text) {
  return String(text || '').replace(/[\r\n\t]+/g, ' ').replace(/\]\]>|[%<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH)
}

/** Seconds until the next message: between min and max (both at least MIN_GAP). */
function nextGap ({ min, max }, random = Math.random) {
  const lo = Math.max(MIN_GAP, Number(min) || MIN_GAP)
  const hi = Math.max(lo, Number(max) || lo)
  return lo + random() * (hi - lo)
}

class Advertiser {
  constructor ({ dispatch, onChange, timers }) {
    this.dispatch = dispatch
    this.onChange = onChange || (() => {})
    this.timers = timers || { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) }
    this.running = null // { messages, min, max, order, room, stayInRoom, next, sent, shown, index }
    this.timer = null
    this.waiting = null // { text, timer } until the server says the last message back
    this.hook = { type: 'aj', message: 'uc', callback: ({ message }) => this._heard(message.value) }
    dispatch.onMessage(this.hook)
  }

  /** The server said a chat line back: if it's ours, it made it into chat. */
  _heard (v) {
    const w = this.waiting
    if (!w || !this.running || !Array.isArray(v) || String(v[5]) !== w.text) return
    this.timers.clear(w.timer)
    this.waiting = null
    this.running.shown++
    this.running.blocked = 0
    this.onChange()
  }

  start ({ messages, min = 60, max = 90, order = 'rotate', stayInRoom = true }) {
    const list = (messages || []).map(cleanMessage).filter(Boolean)
    if (!list.length) throw new Error('Add at least one message.')
    const room = this.dispatch.getState('room')
    if (!room) throw new Error('Join a room in Animal Jam first.')
    this.stop()
    this.running = { messages: list, min, max, order, stayInRoom, room: String(room), sent: 0, shown: 0, blocked: 0, lastBlocked: null, index: 0, next: null, last: null }
    this._send()
    return this.running
  }

  _send () {
    const run = this.running
    if (!run) return
    const room = String(this.dispatch.getState('room') || '')
    if (!room || (run.stayInRoom && room !== run.room)) { this.stop('You left the room, so advertising stopped.'); return }
    const i = run.order === 'random' && run.messages.length > 1
      ? (run.index + 1 + Math.floor(Math.random() * (run.messages.length - 1))) % run.messages.length // never the same twice in a row
      : run.index % run.messages.length
    const text = run.messages[i]
    run.index = run.order === 'random' ? i : i + 1
    Promise.resolve(this.dispatch.sendRemoteMessage(chatPacket(room, text))).catch(() => {})
    run.sent++
    run.last = text
    // No echo back means the game didn't put it in chat (often a filtered word).
    if (this.waiting) this.timers.clear(this.waiting.timer)
    const waiting = { text, timer: null }
    waiting.timer = this.timers.set(() => {
      if (this.waiting !== waiting || this.running !== run) return
      this.waiting = null
      run.blocked++
      run.lastBlocked = text
      this.onChange()
    }, CONFIRM_WITHIN)
    this.waiting = waiting
    const gap = nextGap(run) * 1000
    run.next = Date.now() + gap
    this.timer = this.timers.set(() => this._send(), gap)
    this.onChange()
  }

  stop (reason) {
    if (this.timer) this.timers.clear(this.timer)
    this.timer = null
    if (this.waiting) this.timers.clear(this.waiting.timer)
    this.waiting = null
    const was = this.running
    this.running = null
    if (was) { this.stoppedBecause = reason || null; this.onChange() }
  }

  dispose () {
    this.stop()
    try { this.dispatch.offMessage(this.hook) } catch (_) {}
  }
}

module.exports = { Advertiser, chatPacket, cleanMessage, nextGap, MIN_GAP, MAX_LENGTH }
