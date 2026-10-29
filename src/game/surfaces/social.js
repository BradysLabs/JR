'use strict'

/**
 * Next to the chat bar: Auto Advertise. On the map button: Rooms (Room
 * Browser, Recent Rooms and favorites).
 */

const path = require('path')
const { every } = require('./timers')

/* ------------------------------------------------------- auto advertise */

const advertise = {
  id: 'advertise',
  plugin: 'auto-advertise',
  // Its button is the megaphone the game's chat bar gets (jrChatBar).
  buttons: [],
  init (ctx) {
    const A = this.A = require(path.join(ctx.root, 'plugins', 'auto-advertise', 'advertise.js'))
    this.ad = new A.Advertiser({
      dispatch: ctx.dispatch,
      onChange: () => {
        if (this.ad && !this.ad.running && this.ad.stoppedBecause) { ctx.surfaces.toast(this.ad.stoppedBecause, 'warn'); this.ad.stoppedBecause = null }
        ctx.surfaces.refresh('advertise')
      }
    })
    every(() => { if (this.ad.running) ctx.surfaces.refresh('advertise') }, 1000)
  },
  view (state, ctx) {
    const store = ctx.surfaces.store('auto-advertise')
    const A = this.A
    const run = this.ad.running
    const text = store.get('messages', '')
    const lines = String(text).split('\n').map(A.cleanMessage).filter(Boolean)
    const rows = []
    if (run) {
      const secs = Math.max(0, Math.round((run.next - Date.now()) / 1000))
      rows.push({ t: 'p', c: 'ok', b: true, text: `Advertising · next in ${secs}s` })
      rows.push({ t: 'kv', k: 'Sent', v: String(run.sent) })
      rows.push({ t: 'kv', k: 'Shown in chat', v: String(run.shown) })
      if (run.last) rows.push({ t: 'p', c: 'dim', text: `Last: ${run.last}` })
      if (run.blocked) rows.push({ t: 'p', c: 'warn', text: `“${run.lastBlocked}” didn’t show up in chat. The chat filter probably blocked a word; try rewording it.` })
      rows.push({ t: 'btn', id: 'stop', label: 'Stop', style: 'danger' })
      return { title: 'Auto Advertise', rows }
    }
    rows.push({ t: 'in', id: 'messages', label: `Your ads, one per line (up to ${A.MAX_LENGTH} characters)`, v: text, lines: 4 })
    rows.push({ t: 'p', c: 'dim', text: `${lines.length} message${lines.length === 1 ? '' : 's'}` })
    rows.push({ t: 'num', id: 'min', label: 'Shortest gap (seconds)', v: store.get('min', 60), step: 5 })
    rows.push({ t: 'num', id: 'max', label: 'Longest gap (seconds)', v: store.get('max', 90), step: 5 })
    rows.push({ t: 'chips', id: 'order', label: 'Order', v: store.get('order', 'rotate'), opts: [{ v: 'rotate', l: 'In order' }, { v: 'random', l: 'Random' }] })
    rows.push({ t: 'tog', id: 'stay', label: 'Stop if I leave this room', v: store.get('stay', true) !== false })
    rows.push({ t: 'tog', id: 'antiKick', label: 'Anti-kick', sub: 'Stay logged in while it runs.', v: !!ctx.settings().antiKick })
    rows.push({ t: 'btn', id: 'start', label: 'Start advertising', style: 'primary' })
    return { title: 'Auto Advertise', rows, foot: `At least ${A.MIN_GAP} seconds apart, so your account doesn’t get muted.` }
  },
  act (state, c, v, inputs, ctx) {
    const store = ctx.surfaces.store('auto-advertise')
    const A = this.A
    if (inputs.messages != null) store.set('messages', String(inputs.messages))
    if (c === 'min' || c === 'max') { store.set(c, Math.max(A.MIN_GAP, Math.min(3600, Number(v) || 60))); return }
    if (c === 'order') { store.set('order', v === 'random' ? 'random' : 'rotate'); return }
    if (c === 'stay') { store.set('stay', v === '1'); return }
    if (c === 'antiKick') { ctx.updateSettings({ antiKick: v === '1' }); return }
    if (c === 'stop') { this.ad.stop(); return }
    if (c === 'start') {
      const min = Math.max(A.MIN_GAP, Number(store.get('min', 60)) || 60)
      const max = Math.max(min, Number(store.get('max', 90)) || 90)
      this.ad.start({ messages: String(store.get('messages', '')).split('\n'), min, max, order: store.get('order', 'rotate'), stayInRoom: store.get('stay', true) !== false })
    }
  }
}

/* ------------------------------------------------------------------ rooms */

const rooms = {
  id: 'rooms',
  plugin: 'room-browser',
  // A tab on the World Map (VolumeSelector in tools/game-mod).
  buttons: [],
  init (ctx) {
    this.R = require(path.join(ctx.root, 'plugins', 'recent-rooms', 'rooms.js'))
    try { this.catalog = require(path.join(ctx.root, 'plugins', 'room-browser', 'Rooms.json')).filter(r => r.joinable) } catch (_) { this.catalog = [] }
  },
  view (state, ctx) {
    const tab = state.tab || 'recent'
    const store = ctx.surfaces.store('room-browser')
    const favorites = (store.get('favorites', []) || []).filter(f => f && f.path)
    const isFav = (p) => favorites.some(f => f.path === p)
    const rows = []
    if (tab === 'recent') {
      const recent = ctx.recentRooms().filter(r => r.name !== ctx.dispatch.getState('roomName'))
      if (!recent.length) rows.push({ t: 'p', c: 'dim', text: 'Rooms and dens you visit show here.' })
      for (const r of recent.slice(0, 25)) {
        const d = this.R.describeRoom(r.name)
        rows.push({ t: 'li', text: ctx.mask(d.title), sub: d.detail || null, btns: [{ id: 'go', label: 'Go', style: 'primary', v: r.name }] })
      }
    } else if (tab === 'favorites') {
      if (!favorites.length) rows.push({ t: 'p', c: 'dim', text: 'Star rooms in All rooms to keep them here.' })
      for (const f of favorites) rows.push({ t: 'li', text: f.name, sub: f.category || null, btns: [{ id: 'go', label: 'Go', style: 'primary', v: `${f.path.replace(/\//g, '.')}#1` }, { id: 'fav', label: 'Unstar', v: f.path }] })
    } else {
      rows.push({ t: 'in', id: 'q', label: 'Search every room in Jamaa', v: state.q || '', go: 'Find' })
      const q = String(state.q || '').toLowerCase()
      const hits = this.catalog.filter(r => !q || `${r.name} ${r.category}`.toLowerCase().includes(q))
      for (const r of hits.slice(0, 60)) rows.push({ t: 'li', text: `${r.category} · ${r.name}`, sub: r.ocean ? 'ocean' : null, btns: [{ id: 'go', label: 'Go', style: 'primary', v: `${r.path.replace(/\//g, '.')}#1` }, { id: 'fav', label: isFav(r.path) ? 'Unstar' : 'Star', v: r.path }] })
      if (hits.length > 60) rows.push({ t: 'p', c: 'dim', text: `${hits.length - 60} more. Search to narrow it down.` })
    }
    return { title: 'Rooms', tabs: [{ id: 'recent', l: 'Recent' }, { id: 'favorites', l: 'Favorites' }, { id: 'all', l: 'All rooms' }], tab, rows, h: 320 }
  },
  async act (state, c, v, inputs, ctx) {
    if (c === 'q') { state.q = v.trim(); return }
    if (c === 'fav') {
      const store = ctx.surfaces.store('room-browser')
      const favorites = store.get('favorites', []) || []
      const i = favorites.findIndex(f => f && f.path === v)
      if (i >= 0) favorites.splice(i, 1)
      else { const r = this.catalog.find(x => x.path === v); if (r) favorites.unshift({ name: r.name, path: r.path, category: r.category, joinable: true, ocean: !!r.ocean }) }
      store.set('favorites', favorites.slice(0, 30))
      return
    }
    if (c === 'go') {
      if (!ctx.dispatch.connected) throw new Error('Log in first.')
      await ctx.dispatch.sendRemoteMessage(this.R.joinPacket(ctx.dispatch.getState('room'), v))
      ctx.surfaces.close('rooms')
    }
  }
}

module.exports = [advertise, rooms]
