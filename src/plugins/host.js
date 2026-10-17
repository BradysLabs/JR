'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { EventEmitter } = require('events')
const { readManifest } = require('./manifest')
const { PluginStorage } = require('./storage')
const { readJson, writeJson } = require('../profiles/files')

const SKIP = new Set(['node_modules', '.git', 'data'])

/**
 * Finds, approves and runs plugins for one profile.
 *
 * Plugins that ship with JR run straight away. Any other plugin waits until
 * the user approves it, and if its files change later it has to be approved
 * again (status "changed"). Approvals belong to the profile.
 *
 * Statuses: running (background plugin on), ready (window plugin can open),
 * needs-approval, changed, off, error.
 *
 * Events: 'change' (plugins list changed).
 */
class PluginHost extends EventEmitter {
  /**
   * @param {object} options
   * @param {{path: string, builtIn?: boolean}[]} options.folders folders that contain plugin folders
   * @param {string} options.profileDir
   * @param {import('../engine/dispatch').Dispatch} options.dispatch
   * @param {object} options.application the `application` object plugins get
   * @param {(e: {type: string, message: string}) => void} [options.log]
   */
  constructor ({ folders, profileDir, dispatch, application, log = () => {} }) {
    super()
    this.folders = folders
    this.profileDir = profileDir
    this.dispatch = dispatch
    this.application = application
    this.log = log
    this.settingsFile = path.join(profileDir, 'plugins.json')
    this.plugins = new Map()
  }

  /** Scans the plugin folders and starts every allowed background plugin. */
  load () {
    this.unloadAll()
    this.plugins.clear()
    const settings = this._settings()

    for (const folder of this.folders) {
      let entries = []
      try { entries = fs.readdirSync(folder.path, { withFileTypes: true }) } catch (_) { continue }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const dir = path.join(folder.path, entry.name)
        const id = pluginId(entry.name)
        if (this.plugins.has(id)) {
          this.log({ type: 'warn', message: `Skipped a second plugin folder called "${entry.name}".` })
          continue
        }
        const plugin = { id, dir, builtIn: !!folder.builtIn, status: 'error', errors: [], manifest: null, hash: null, running: null }
        this.plugins.set(id, plugin)

        const read = readManifest(dir)
        if (!read.ok) {
          plugin.errors = read.errors
          this.log({ type: 'error', message: `Plugin "${entry.name}" can't load: ${read.errors.join('; ')}.` })
          continue
        }
        plugin.manifest = read.manifest
        plugin.hash = plugin.builtIn ? null : hashFolder(dir)
        plugin.status = this._statusOf(plugin, settings)
      }
    }

    for (const plugin of this.plugins.values()) {
      if (plugin.status === 'running') this._start(plugin)
    }
    this.emit('change')
    return this.list()
  }

  list () {
    return [...this.plugins.values()].map(p => ({
      id: p.id,
      builtIn: p.builtIn,
      status: p.status,
      errors: p.errors.slice(),
      ...(p.manifest || { name: p.id })
    }))
  }

  get (id) { return this.plugins.get(id) || null }

  /** The user said yes to running this plugin. */
  approve (id) {
    const plugin = this._need(id)
    const settings = this._settings()
    if (!plugin.builtIn) settings.approved[id] = plugin.hash
    settings.off = settings.off.filter(x => x !== id)
    this._saveSettings(settings)
    this._refresh(plugin, settings)
  }

  /** Turns a plugin off for this profile. */
  turnOff (id) {
    const plugin = this._need(id)
    const settings = this._settings()
    if (!settings.off.includes(id)) settings.off.push(id)
    this._saveSettings(settings)
    this._refresh(plugin, settings)
  }

  /** Turns a plugin back on (non-built-in plugins may still need approval). */
  turnOn (id) {
    const plugin = this._need(id)
    const settings = this._settings()
    settings.off = settings.off.filter(x => x !== id)
    this._saveSettings(settings)
    this._refresh(plugin, settings)
  }

  /**
   * What a window plugin's page gets as `window.jam`. Call dispose() when the
   * window closes; it removes everything the window hooked.
   */
  openWindow (id) {
    const plugin = this._need(id)
    if (plugin.status !== 'ready') throw new Error(`"${plugin.manifest ? plugin.manifest.name : id}" can't open right now (${plugin.status}).`)
    const scope = this._scope(plugin)
    return {
      plugin: describe(plugin),
      dispatch: scope.dispatch,
      application: this.application,
      onPacket: scope.dispatch.onPacket,
      storage: scope.storage,
      dataPath: scope.dataPath,
      entry: path.join(plugin.dir, plugin.manifest.main),
      dispose: scope.dispose
    }
  }

  /** Stops every background plugin and writes their data. */
  unloadAll () {
    for (const plugin of this.plugins.values()) this._stop(plugin)
  }

  _refresh (plugin, settings) {
    const before = plugin.status
    plugin.status = this._statusOf(plugin, settings)
    if (before === 'running' && plugin.status !== 'running') this._stop(plugin)
    if (plugin.status === 'running' && !plugin.running) this._start(plugin)
    this.emit('change')
  }

  _statusOf (plugin, settings) {
    if (!plugin.manifest) return 'error'
    if (settings.off.includes(plugin.id)) return 'off'
    if (!plugin.builtIn) {
      const approved = settings.approved[plugin.id]
      if (!approved) return 'needs-approval'
      if (approved !== plugin.hash) return 'changed'
    }
    return plugin.manifest.type === 'game' ? 'running' : 'ready'
  }

  _start (plugin) {
    const scope = this._scope(plugin)
    const main = path.join(plugin.dir, plugin.manifest.main)
    try {
      forget(plugin.dir)
      const exported = require(main)
      const fn = typeof exported === 'function' ? exported : exported && exported.default
      if (typeof fn !== 'function') throw new Error(`${plugin.manifest.main} must export a function`)
      const context = {
        application: this.application,
        dispatch: scope.dispatch,
        storage: scope.storage,
        dataPath: scope.dataPath,
        plugin: describe(plugin)
      }
      let result
      if (isClass(fn)) {
        // eslint-disable-next-line new-cap
        result = new fn(context)
      } else {
        result = fn(context)
      }
      scope.onStop = typeof result === 'function' ? result : result && typeof result.dispose === 'function' ? () => result.dispose() : null
      plugin.running = scope
      plugin.errors = []
    } catch (error) {
      scope.dispose()
      plugin.status = 'error'
      plugin.errors = [error.message]
      this.log({ type: 'error', message: `Plugin "${plugin.manifest.name}" failed to start: ${error.message}` })
    }
  }

  _stop (plugin) {
    if (!plugin.running) return
    const scope = plugin.running
    plugin.running = null
    scope.dispose()
  }

  /**
   * A view of the dispatch that remembers what one plugin added, so all of
   * it can be removed when the plugin stops or its window closes.
   */
  _scope (plugin) {
    const dispatch = this.dispatch
    const hooks = []
    const commands = []
    const watchers = []
    const intervals = new Set()
    const dataPath = path.join(this.profileDir, 'plugin-data', plugin.id)
    const storage = new PluginStorage(dataPath)
    let disposed = false

    const view = {
      get connected () { return dispatch.connected },
      get hooks () { return dispatch.hooks },
      get state () { return dispatch.state },
      onMessage (hook) {
        dispatch.onMessage(hook)
        hooks.push(hook)
        return view
      },
      offMessage (hook) {
        dispatch.offMessage(hook)
        return view
      },
      onPacket (fn) {
        const stop = dispatch.onPacket(fn)
        watchers.push(stop)
        return stop
      },
      onCommand (command) {
        dispatch.onCommand(command)
        commands.push(command)
        return view
      },
      offCommand (command) {
        dispatch.offCommand(command)
        return view
      },
      sendRemoteMessage: (text) => dispatch.sendRemoteMessage(text),
      sendConnectionMessage: (text) => dispatch.sendConnectionMessage(text),
      sendMultipleMessages: (options) => dispatch.sendMultipleMessages(options),
      serverMessage: (text) => dispatch.serverMessage(text),
      getState: (key) => dispatch.getState(key),
      setState: (key, value) => { dispatch.setState(key, value); return view },
      wait: (ms) => dispatch.wait(ms),
      setInterval (fn, ms) {
        const id = dispatch.setInterval(fn, ms)
        intervals.add(id)
        return id
      },
      clearInterval (id) {
        dispatch.clearInterval(id)
        intervals.delete(id)
      },
      on: (...args) => { dispatch.on(...args); return view },
      off: (...args) => { dispatch.off(...args); return view }
    }

    const scope = {
      dispatch: view,
      storage,
      dataPath,
      onStop: null,
      dispose: () => {
        if (disposed) return
        disposed = true
        if (scope.onStop) {
          try { scope.onStop() } catch (_) {}
        }
        for (const hook of hooks) dispatch.offMessage(hook)
        for (const command of commands) {
          const current = dispatch.commands.get(String(command.name).toLowerCase())
          if (current && current.callback === command.callback) dispatch.offCommand(command)
        }
        for (const stop of watchers) stop()
        for (const id of intervals) dispatch.clearInterval(id)
        storage.flush()
      }
    }
    return scope
  }

  _need (id) {
    const plugin = this.plugins.get(id)
    if (!plugin) throw new Error(`No plugin "${id}".`)
    return plugin
  }

  _settings () {
    const s = readJson(this.settingsFile, {})
    return {
      approved: s && typeof s.approved === 'object' && s.approved ? s.approved : {},
      off: s && Array.isArray(s.off) ? s.off : []
    }
  }

  _saveSettings (settings) {
    writeJson(this.settingsFile, settings)
  }
}

function describe (plugin) {
  return { id: plugin.id, dir: plugin.dir, builtIn: plugin.builtIn, ...plugin.manifest }
}

function pluginId (folderName) {
  return folderName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
}

/** A fingerprint of a plugin's files, so JR notices when they change. */
function hashFolder (dir) {
  const hash = crypto.createHash('sha256')
  const walk = (d, rel) => {
    const entries = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (SKIP.has(e.name) || e.name.startsWith('.')) continue
      const full = path.join(d, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(full, r)
      else if (e.isFile()) {
        hash.update(r).update('\0').update(fs.readFileSync(full)).update('\0')
      }
    }
  }
  walk(dir, '')
  return hash.digest('hex')
}

/** Drops a plugin's modules from Node's cache so a reload runs fresh code. */
function forget (dir) {
  const prefix = path.resolve(dir) + path.sep
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(prefix)) delete require.cache[key]
  }
}

function isClass (fn) {
  return /^class[\s{]/.test(Function.prototype.toString.call(fn))
}

module.exports = { PluginHost, hashFolder }
