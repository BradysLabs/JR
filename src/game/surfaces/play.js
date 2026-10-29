'use strict'

/**
 * Playing: Adventures and Gem Farm (in the adventure screen), Achievements
 * (in the achievements book) and Pairs (in the Pairs game).
 */

const fs = require('fs')
const path = require('path')
const { every } = require('./timers')
const vm = require('vm')
const Module = require('module')
const { createFakePage, fakeLocalStorage } = require('./fakedom')

/* ------------------------------------------------------------ adventures */

// The Adventures plugin's own runner, loaded without its window. The extra
// line at the end gives JR the controls its buttons would have.
const CONTROLS = `
;globalThis.__jr = {
  list: ADVENTURES,
  select (i) { if (running) return; selected = ADVENTURES[i] || selected; mode = selected ? selected.modes[0] : null; renderAll() },
  setMode (m) { if (!running && selected && selected.modes.includes(m)) { mode = m; renderAll() } },
  start (here) { return startRun(!!here) },
  stop () { stopRun() },
  state () { return { running, id: selected && selected.id, mode } },
  choices (a) { return choicesFor(a) },
  setChoices (a, list) { setChoices(a, list) }
};`

const adventures = {
  id: 'adventures',
  plugin: 'adventure-runner',
  // Also a tab on the World Map (VolumeSelector in tools/game-mod).
  buttons: [{ at: 'adventure', label: 'Auto Run' }],
  _load (ctx) {
    if (this.jr) return this.jr
    const file = path.join(ctx.root, 'plugins', 'adventure-runner', 'index.js')
    const page = this.page = createFakePage()
    const store = ctx.surfaces.store('adventure-runner')
    const sandbox = {
      jam: { dispatch: ctx.dispatch, application: ctx.application, storage: null },
      document: page.document,
      localStorage: fakeLocalStorage(store),
      console: { log () {}, warn () {}, error: (...a) => ctx.log({ type: 'warn', message: `Adventures: ${a.join(' ')}` }) },
      setTimeout, clearTimeout, setInterval, clearInterval,
      require: Module.createRequire(file),
      __dirname: path.dirname(file)
    }
    sandbox.window = sandbox
    page.element('loopToggle').checked = false
    page.element('loopRuns').value = '0'
    page.element('loopDelay').value = '5'
    page.element('prizeChoice').value = 'manual'
    vm.runInNewContext(fs.readFileSync(file, 'utf8') + CONTROLS, sandbox, { filename: file })
    this.jr = sandbox.__jr
    every(() => { if (this.jr.state().running) ctx.surfaces.refresh('adventures') }, 1500)
    return this.jr
  },
  view (state, ctx) {
    const jr = this._load(ctx)
    const page = this.page
    const s = jr.state()
    const adv = jr.list.find(a => a.id === s.id) || jr.list[0]
    const rows = []
    if (!s.running) rows.push({ t: 'p', c: 'dim', text: 'JR plays the adventure for you. Pick one, type the host’s username (or leave it empty to play alone where you can), then press Start. Already inside one? Press Run here.' })
    rows.push({ t: 'chips', id: 'pick', label: 'Adventure', v: String(jr.list.indexOf(adv)), opts: jr.list.map((a, i) => ({ v: String(i), l: a.name })) })
    if (adv.modes.length > 1) rows.push({ t: 'chips', id: 'mode', label: 'Mode', v: s.mode, opts: adv.modes.map(m => ({ v: m, l: m[0].toUpperCase() + m.slice(1) })) })
    if (adv.choices) {
      const on = jr.choices(adv)
      for (const o of adv.choices.options) rows.push({ t: 'tog', id: 'choice', label: `${adv.choices.label}: ${o.label}`, v: on.includes(o.id), vId: o.id })
      rows.forEach(r => { if (r.vId) { r.id = `choice:${r.vId}`; delete r.vId } })
    }
    rows.push({ t: 'in', id: 'host', label: adv.solo ? 'Host’s username (leave empty to play alone)' : 'Host’s username', v: page.element('hostName').value, max: 23 })
    rows.push({ t: 'tog', id: 'loop', label: 'Keep going', sub: 'Join the host’s next game after each one.', v: !!page.element('loopToggle').checked })
    rows.push({ t: 'chips', id: 'prize', label: 'Prize', v: page.element('prizeChoice').value, opts: [{ v: 'manual', l: 'I’ll pick' }, ...[1, 2, 3, 4, 5].map(n => ({ v: String(n), l: `Slot ${n}` }))] })
    if (s.running) {
      rows.push({ t: 'p', c: 'ok', b: true, text: page.element('status').textContent || 'Running…' })
      if (page.element('runCounter').textContent) rows.push({ t: 'p', c: 'dim', text: page.element('runCounter').textContent })
      rows.push({ t: 'btn', id: 'stop', label: 'Stop', style: 'danger' })
    } else {
      if (page.element('status').textContent) rows.push({ t: 'p', c: 'dim', text: page.element('status').textContent })
      rows.push({ t: 'row', items: [{ id: 'start', label: 'Start', style: 'primary' }, { id: 'here', label: 'Run here' }] })
    }
    const log = page.element('log').children.slice(-6)
    if (log.length) {
      rows.push({ t: 'sep' })
      for (const l of log) rows.push({ t: 'p', c: l.className === 'error' ? 'bad' : l.className === 'warn' ? 'warn' : l.className === 'ok' ? 'ok' : 'dim', text: ctx.mask(l.textContent) })
    }
    return { title: 'Adventures', rows, foot: '“Run here” runs the adventure you’re already in.', h: 330 }
  },
  act (state, c, v, inputs, ctx) {
    const jr = this._load(ctx)
    const page = this.page
    if (inputs.host != null) page.element('hostName').value = String(inputs.host)
    if (c === 'pick') { jr.select(Number(v)); return }
    if (c === 'mode') { jr.setMode(v); return }
    if (c === 'loop') { page.element('loopToggle').checked = v === '1'; return }
    if (c === 'prize') { page.element('prizeChoice').value = v; return }
    if (c.startsWith('choice:')) {
      const adv = jr.list.find(a => a.id === jr.state().id)
      const id = c.slice(7)
      const now = jr.choices(adv).filter(x => x !== id)
      if (v === '1') now.push(id)
      jr.setChoices(adv, adv.choices.options.map(o => o.id).filter(x => now.includes(x)))
      return
    }
    if (c === 'stop') { jr.stop(); return }
    if (c === 'start' || c === 'here' || c === 'host') {
      Promise.resolve(jr.start(c === 'here')).catch(e => ctx.surfaces.toast(e.message, 'bad')).then(() => ctx.surfaces.refresh('adventures'))
    }
  }
}

/* ------------------------------------------------------------- gem farm */

const gemFarm = {
  id: 'gemfarm',
  plugin: 'gem-farm',
  buttons: [{ at: 'adventure', label: 'Gem Farm' }],
  init (ctx) {
    const { GemFarm, MIN_DELAY } = require(path.join(ctx.root, 'plugins', 'gem-farm', 'farm.js'))
    this.MIN = MIN_DELAY
    this.farm = new GemFarm({ dispatch: ctx.dispatch, onChange: () => ctx.surfaces.refresh('gemfarm') })
  },
  view (state, ctx) {
    const f = this.farm
    const rows = []
    rows.push({ t: 'p', c: 'dim', text: 'Collects the gem prize from adventure #49 over and over.' })
    rows.push({ t: 'num', id: 'delay', label: 'Milliseconds between steps', v: f.delay, step: 50 })
    rows.push({ t: 'tog', id: 'recycle', label: 'Recycle the prize items for more gems', v: f.recycle })
    if (f.running) {
      rows.push({ t: 'kv', k: 'Rounds', v: String(f.stats.cycles), c: 'ok' })
      rows.push({ t: 'kv', k: 'Items recycled', v: String(f.stats.recycled) })
      rows.push({ t: 'btn', id: 'stop', label: 'Stop', style: 'danger' })
    } else {
      rows.push({ t: 'btn', id: 'start', label: 'Start farming', style: 'primary' })
      if (f.lastError) rows.push({ t: 'p', c: 'bad', text: f.lastError })
    }
    return { title: 'Gem Farm', rows }
  },
  act (state, c, v, inputs, ctx) {
    const f = this.farm
    if (c === 'delay') { f.delay = Math.max(this.MIN, Math.min(5000, Number(v) || 500)); return }
    if (c === 'recycle') { f.recycle = v === '1'; return }
    if (c === 'stop') { f.stop(); return }
    if (c === 'start') f.start().catch(e => ctx.surfaces.toast(e.message, 'bad'))
  }
}

/* ---------------------------------------------------------- achievements */

const achievements = {
  id: 'achievements',
  plugin: 'achievements',
  buttons: [{ at: 'achievements', label: 'Send' }],
  init (ctx) {
    const html = fs.readFileSync(path.join(ctx.root, 'plugins', 'achievements', 'index.html'), 'utf8')
    const m = /const achievements = \[([\d,\s]+)\]/.exec(html)
    this.ids = m ? m[1].split(',').map(x => Number(x.trim())).filter(Number.isFinite) : []
    this.info = new Map()
    this.batch = null
  },
  async opened (state, ctx) {
    if (this.info.size) return
    const items = ctx.items
    if (!items.deployVersion) await items.load()
    const [pack, strings] = await Promise.all([items.fetchPack(items.deployVersion, '1042'), items.fetchPack(items.deployVersion, '10230')])
    const str = (k) => (strings && typeof strings[k] === 'string' && strings[k].trim()) || null
    const pick = (e, re) => { for (const [f, val] of Object.entries(e)) if (re.test(f) && /str(id|ref)?$/i.test(f)) { const t = str(val); if (t) return t } return null }
    for (const [key, e] of Object.entries(pack || {})) {
      if (!e || typeof e !== 'object') continue
      const id = Number(e.id !== undefined ? e.id : key)
      const extra = e.extraText ? String(e.extraText) : ''
      const fill = (t) => (t && extra ? t.replace(/\{0\}|%s/g, extra) : t)
      this.info.set(id, { name: fill(pick(e, /title/i)) || String(e.name || '').replace(/^\d+_/, '').replace(/_/g, ' '), desc: fill(pick(e, /desc/i)) })
    }
  },
  _send (ctx, id) {
    const room = ctx.dispatch.getState('room')
    if (!room) throw new Error('Join a room first.')
    return ctx.dispatch.sendRemoteMessage(`%xt%o%zs%${room}%${id}%9999999%1%`)
  },
  view (state, ctx) {
    const rows = []
    if (this.batch) {
      rows.push({ t: 'p', c: 'warn', text: `Sending ${this.batch.done} of ${this.ids.length}…` })
      rows.push({ t: 'btn', id: 'stopall', label: 'Stop', style: 'danger' })
    } else {
      rows.push({ t: 'btn', id: 'all', label: state.confirm ? `Press again to send all ${this.ids.length}` : `Send all ${this.ids.length}`, style: state.confirm ? 'danger' : 'primary' })
    }
    rows.push({ t: 'in', id: 'q', label: 'Search', v: state.q || '', go: 'Find' })
    const q = String(state.q || '').toLowerCase()
    for (const id of this.ids) {
      const i = this.info.get(id) || {}
      const name = i.name || `Achievement #${id}`
      if (q && !`${name} ${i.desc || ''}`.toLowerCase().includes(q)) continue
      rows.push({ t: 'li', text: name, sub: i.desc || null, btns: [{ id: 'one', label: 'Send', v: String(id) }] })
    }
    return { title: 'Achievements', rows, h: 330 }
  },
  async act (state, c, v, inputs, ctx) {
    if (c !== 'all') state.confirm = false
    if (c === 'q') { state.q = v.trim(); return }
    if (c === 'one') { await this._send(ctx, Number(v)); ctx.surfaces.toast(`Sent ${(this.info.get(Number(v)) || {}).name || `#${v}`}.`, 'ok'); return }
    if (c === 'stopall') { if (this.batch) this.batch.stopped = true; return }
    if (c === 'all') {
      if (!state.confirm) { state.confirm = true; return }
      state.confirm = false
      const batch = this.batch = { done: 0, stopped: false }
      ;(async () => {
        for (const id of this.ids) {
          if (batch.stopped) break
          await this._send(ctx, id)
          batch.done++
          if (batch.done % 5 === 0) ctx.surfaces.refresh('achievements')
          await new Promise(resolve => setTimeout(resolve, 110))
        }
      })().catch(e => ctx.surfaces.toast(e.message, 'bad')).then(() => {
        this.batch = null
        ctx.surfaces.toast(`Sent ${batch.done} achievements.`, 'ok')
        ctx.surfaces.refresh('achievements')
      })
    }
  }
}

/* ------------------------------------------------------------------ pairs */

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

function parseCards (parts) {
  const r = parts.indexOf('round')
  if (r !== -1 && Number(parts[r + 3]) === 16) {
    const ids = parts.slice(r + 4, r + 20)
    if (ids.length === 16 && ids.every(x => /^\d+$/.test(x))) return ids.map(Number)
  }
  for (let i = 0; i + 16 < parts.length; i++) {
    if (parts[i] !== '16') continue
    const ids = parts.slice(i + 1, i + 17)
    if (ids.every(x => /^\d+$/.test(x) && +x >= 1 && +x <= 16) && new Set(ids).size === 16) return ids.map(Number)
  }
  return null
}

const pairs = {
  id: 'pairs',
  plugin: 'pairs',
  buttons: [{ at: 'pairs', label: 'Show Pairs' }],
  init (ctx) {
    this.cards = null
    ctx.dispatch.onMessage({
      type: 'aj',
      message: 'mm',
      callback: ({ message }) => {
        const parts = (Array.isArray(message.value) ? message.value : String(message.raw || '').split('%')).map(String).filter(Boolean)
        const ids = parseCards(parts)
        if (ids) { this.cards = ids; ctx.surfaces.refresh('pairs') }
      }
    })
    ctx.dispatch.onMessage({ type: 'aj', message: 'rl', callback: () => { this.cards = null; ctx.surfaces.refresh('pairs') } })
  },
  view () {
    const rows = []
    if (!this.cards) {
      rows.push({ t: 'p', c: 'dim', text: 'Waiting for a round to start…' })
    } else {
      rows.push({ t: 'p', c: 'dim', text: 'Same letter = a pair. Laid out like the cards on the table.' })
      for (let r = 0; r < 4; r++) {
        rows.push({ t: 'row', items: this.cards.slice(r * 4, r * 4 + 4).map(cid => ({ id: 'card', label: LETTERS[(((cid - 1) % 8) + 8) % 8], style: 'normal' })) })
      }
    }
    return { title: 'Pairs', rows, w: 240 }
  }
}

module.exports = [adventures, gemFarm, achievements, pairs]
