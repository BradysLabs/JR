'use strict'

/**
 * Spaces out work so no more than `perSecond` jobs start in any one-second
 * window. Extra jobs wait in line instead of being dropped.
 */
class Limiter {
  constructor ({ perSecond = 20, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.perSecond = perSecond
    this.now = now
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.started = [] // start times inside the current window
    this.waiting = []
    this.timer = null
  }

  /** Runs `job` when allowed. Resolves with its result. */
  run (job) {
    return new Promise((resolve, reject) => {
      this.waiting.push({ job, resolve, reject })
      this._drain()
    })
  }

  get pending () { return this.waiting.length }

  /** Drops every waiting job (their promises reject). */
  clear (reason = 'Cleared') {
    const jobs = this.waiting.splice(0)
    if (this.timer) { this.clearTimer(this.timer); this.timer = null }
    for (const j of jobs) j.reject(new Error(reason))
  }

  setRate (perSecond) {
    this.perSecond = Math.max(1, Number(perSecond) || 1)
    this._drain()
  }

  _drain () {
    if (this.timer) return
    const limit = this.perSecond
    while (this.waiting.length) {
      const t = this.now()
      while (this.started.length && t - this.started[0] >= 1000) this.started.shift()
      if (this.started.length >= limit) {
        const wait = 1000 - (t - this.started[0])
        this.timer = this.setTimer(() => { this.timer = null; this._drain() }, Math.max(1, wait))
        return
      }
      const { job, resolve, reject } = this.waiting.shift()
      this.started.push(t)
      try { Promise.resolve(job()).then(resolve, reject) } catch (e) { reject(e) }
    }
  }
}

module.exports = { Limiter }
