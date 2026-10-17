'use strict'

const fs = require('fs')
const path = require('path')
const { readJson, writeJson } = require('../profiles/files')

/**
 * A plugin's saved data in one profile: a small key/value store kept in
 * <profile>/plugin-data/<plugin id>/storage.json. Each profile has its own,
 * so two profiles running the same plugin never see each other's data.
 */
class PluginStorage {
  constructor (dir, { delay = 250 } = {}) {
    this.dir = dir
    this.file = path.join(dir, 'storage.json')
    this.delay = delay
    this.data = readJson(this.file, {})
    if (!this.data || typeof this.data !== 'object' || Array.isArray(this.data)) this.data = {}
    this.timer = null
  }

  get (key, fallback) {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? clone(this.data[key]) : fallback
  }

  set (key, value) {
    if (value === undefined) return this.delete(key)
    this.data[key] = clone(value)
    this._schedule()
  }

  delete (key) {
    delete this.data[key]
    this._schedule()
  }

  all () { return clone(this.data) }

  clear () {
    this.data = {}
    this._schedule()
  }

  /** Writes pending changes now. */
  flush () {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (!this.dirty) return
    this.dirty = false
    fs.mkdirSync(this.dir, { recursive: true })
    writeJson(this.file, this.data)
  }

  _schedule () {
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => { this.timer = null; this.flush() }, this.delay)
    if (this.timer.unref) this.timer.unref()
  }
}

function clone (v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v))
}

module.exports = { PluginStorage }
