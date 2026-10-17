/**
 * Packet Spammer, by BradysLabs: the sending logic, separate from the page so
 * it can be tested.
 *
 * A step is { to: 'server' | 'game', text, delay } where delay is seconds to
 * wait after sending. {room} in a packet becomes your current room.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.SpammerRunner = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  const MIN_DELAY = 0.05

  /** Splits a text box into packets: one per non-empty line. */
  function splitPackets (text) {
    return String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  }

  function fill (text, dispatch) {
    if (!text.includes('{room}')) return text
    const room = dispatch.getState('room')
    if (!room) throw new Error('Join a room first: this packet uses {room}.')
    return text.split('{room}').join(room)
  }

  async function sendOne (dispatch, to, text) {
    const packet = fill(text, dispatch)
    if (to === 'game') dispatch.sendConnectionMessage(packet)
    else await dispatch.sendRemoteMessage(packet)
    return packet
  }

  /**
   * Runs a list of steps once or on repeat.
   * @param {object} dispatch JR's dispatch
   * @param {{to: string, text: string, delay: number}[]} steps
   * @param {{loop?: boolean, onStep?: (index: number) => void, onError?: (e: Error) => void, onDone?: () => void, wait?: (ms: number) => Promise<void>}} [options]
   * @returns {{stop: () => void, done: Promise<void>}}
   */
  function run (dispatch, steps, options = {}) {
    const { loop = false, onStep = () => {}, onError = () => {}, onDone = () => {} } = options
    let stopped = false
    let wake = null
    const wait = options.wait || ((ms) => new Promise(resolve => {
      const t = setTimeout(resolve, ms)
      wake = () => { clearTimeout(t); resolve() }
    }))

    const done = (async () => {
      if (!steps.length) return
      do {
        for (let i = 0; i < steps.length && !stopped; i++) {
          const step = steps[i]
          onStep(i)
          try {
            await sendOne(dispatch, step.to, step.text)
          } catch (error) {
            onError(error)
            stopped = true
            break
          }
          if (stopped) break
          await wait(Math.max(MIN_DELAY, Number(step.delay) || 0) * 1000)
        }
      } while (loop && !stopped)
    })().finally(() => onDone())

    return {
      stop () {
        stopped = true
        if (wake) wake()
      },
      done
    }
  }

  return { splitPackets, fill, sendOne, run, MIN_DELAY }
})
