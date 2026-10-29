'use strict'

/**
 * JR's own button on the game's toolbar: a menu of everything, plus the
 * tools that have no better home in the game (Packet Spammer, Membership)
 * and links to the ones that need JR's full window.
 */

const path = require('path')

// Open-anywhere shortcuts: the surfaces that also live on a game screen.
const SHORTCUTS = [
  ['worth', 'Inventory Worth'], ['outfits', 'Outfits'], ['tryon', 'Try On'], ['glow', 'Glow'],
  ['advertise', 'Auto Advertise'], ['rooms', 'Rooms'], ['myshop', 'My Shop Tools'], ['explorer', 'Shop Explorer'],
  ['recycle', 'Recycle Presets'], ['denshop', 'Den Shop'], ['animals', 'Animal Buyer'], ['pets', 'Pet Catalog'],
  ['adventures', 'Adventures'], ['gemfarm', 'Gem Farm'], ['achievements', 'Achievements']
]

// Tools that work best in a JR window (big tables, files from your computer).
const WINDOWS = [
  ['packet-inspector', 'Packet Inspector'],
  ['asset-browser', 'Asset Browser'],
  ['name-checker', 'Name Checker'],
  ['masterpiece', 'Masterpiece Studio']
]

const menu = {
  id: 'menu',
  // Its button is the round JR button on the chat bar (jrChatBar).
  buttons: [],
  view (state, ctx) {
    const rows = []
    const s = ctx.settings()
    rows.push({ t: 'kv', k: 'JR', v: `${ctx.version}${ctx.dispatch.connected ? ' · connected' : ''}`, c: 'ok' })
    rows.push({ t: 'tog', id: 'membership', label: 'Membership', sub: 'Member features on your game only. Next login.', v: ctx.membership() })
    rows.push({ t: 'tog', id: 'antiKick', label: 'Anti-kick', sub: 'Don’t get logged out for being idle.', v: !!s.antiKick })
    rows.push({ t: 'sep' })
    rows.push({ t: 'h', text: 'Open' })
    const shown = SHORTCUTS.filter(([id]) => ctx.surfaceEnabled(id))
    for (let i = 0; i < shown.length; i += 3) rows.push({ t: 'row', items: shown.slice(i, i + 3).map(([id, l]) => ({ id: 'open', label: l, v: id })) })
    rows.push({ t: 'row', items: [{ id: 'open', label: 'Packet Spammer', v: 'spammer' }, { id: 'focus', label: 'JR Window', v: '' }] })
    rows.push({ t: 'sep' })
    rows.push({ t: 'h', text: 'In JR’s window' })
    for (let i = 0; i < WINDOWS.length; i += 2) rows.push({ t: 'row', items: WINDOWS.slice(i, i + 2).map(([id, l]) => ({ id: 'window', label: l, v: id })) })
    return { title: 'JR', rows, foot: 'Most of these also have a button on the game screen they belong to.', w: 360, h: 360 }
  },
  act (state, c, v, inputs, ctx) {
    if (c === 'membership') { ctx.setMembership(v === '1'); ctx.surfaces.toast('Membership changes at your next login.', 'ok'); return }
    if (c === 'antiKick') { ctx.updateSettings({ antiKick: v === '1' }); return }
    if (c === 'open') { ctx.surfaces.open(v); return }
    if (c === 'window') { ctx.openPlugin(v); ctx.surfaces.toast('Opened in JR’s window.', 'ok'); return }
    if (c === 'focus') ctx.focusJR()
  }
}

/* ------------------------------------------------------- packet spammer */

const spammer = {
  id: 'spammer',
  plugin: 'packet-spammer',
  buttons: [],
  init (ctx) {
    this.R = require(path.join(ctx.root, 'plugins', 'packet-spammer', 'runner.js'))
    this.job = null
    this.step = -1
  },
  view (state, ctx) {
    const store = ctx.surfaces.store('packet-spammer')
    const steps = store.get('steps', []) || []
    const rows = []
    rows.push({ t: 'in', id: 'packet', label: 'Packet ({room} = your room)', v: state.packet || '', max: 2000 })
    rows.push({ t: 'row', items: [{ id: 'send', label: 'Send to server', style: 'primary', v: 'server' }, { id: 'send', label: 'Send to my game', v: 'game' }, { id: 'add', label: 'Add to list' }] })
    rows.push({ t: 'sep' })
    rows.push({ t: 'h', text: `List (${steps.length})` })
    steps.forEach((s, i) => rows.push({ t: 'li', text: s.text.length > 70 ? s.text.slice(0, 70) + '…' : s.text, sub: `${s.to === 'game' ? 'to my game' : 'to server'} · then wait ${s.delay}s`, sel: this.job && this.step === i, btns: [{ id: 'remove', label: 'X', style: 'danger', v: String(i) }] }))
    if (steps.length) {
      rows.push({ t: 'tog', id: 'loop', label: 'Repeat the list', v: !!state.loop })
      rows.push(this.job ? { t: 'btn', id: 'stop', label: 'Stop', style: 'danger' } : { t: 'btn', id: 'run', label: 'Run the list', style: 'primary' })
    }
    return { title: 'Packet Spammer', rows, h: 330 }
  },
  async act (state, c, v, inputs, ctx) {
    const store = ctx.surfaces.store('packet-spammer')
    const steps = store.get('steps', []) || []
    if (inputs.packet != null) state.packet = String(inputs.packet)
    if (c === 'packet' || c === 'send') {
      const text = String(state.packet || '').trim()
      if (!text) throw new Error('Type a packet first.')
      await this.R.sendOne(ctx.dispatch, c === 'send' ? v : 'server', text)
      ctx.surfaces.toast('Sent.', 'ok')
      return
    }
    if (c === 'add') {
      const text = String(state.packet || '').trim()
      if (!text) throw new Error('Type a packet first.')
      steps.push({ to: 'server', text, delay: 1 })
      store.set('steps', steps)
      return
    }
    if (c === 'remove') { steps.splice(Number(v), 1); store.set('steps', steps); return }
    if (c === 'loop') { state.loop = v === '1'; return }
    if (c === 'stop') { if (this.job) this.job.stop(); return }
    if (c === 'run') {
      this.job = this.R.run(ctx.dispatch, steps, {
        loop: !!state.loop,
        onStep: (i) => { this.step = i; ctx.surfaces.refresh('spammer') },
        onError: (e) => ctx.surfaces.toast(e.message, 'bad'),
        onDone: () => { this.job = null; this.step = -1; ctx.surfaces.refresh('spammer') }
      })
    }
  }
}

/* ------------------------------------------------------------ masterpiece */

const masterpiece = {
  id: 'masterpiece',
  plugin: 'masterpiece',
  buttons: [{ at: 'masterpiece', label: 'Studio' }],
  view () {
    return {
      title: 'Masterpiece Studio',
      rows: [
        { t: 'p', text: 'Turn a picture from your computer into a masterpiece, or see the picture inside one.' },
        { t: 'p', c: 'dim', text: 'Picking files from your computer happens in JR’s window.' },
        { t: 'btn', id: 'open', label: 'Open Masterpiece Studio', style: 'primary' }
      ]
    }
  },
  act (state, c, v, inputs, ctx) { if (c === 'open') { ctx.openPlugin('masterpiece'); ctx.surfaces.close('masterpiece') } }
}

// Art Studio's Picture button: the game itself turns the picture into the
// painting (JRPicturePopup), which it can then save as an .ajart file.
const picture = {
  id: 'picture',
  plugin: 'masterpiece',
  buttons: [{ at: 'artstudio', label: 'Picture', icon: 'picture', local: 'picture' }],
  view () { return { title: 'Picture to Masterpiece', rows: [{ t: 'p', text: 'Use the Picture button in the Art Studio.' }] } }
}

// More Sorts: the game sorts the items itself (JRSortMenu and jrSortItems in
// tools/game-mod); Most valuable asks JR for worth ("k").
const sorting = {
  id: 'sorting',
  buttons: [
    { at: 'densort', label: 'More Sorts', icon: 'sort', local: 'densort' }
  ],
  view () { return { title: 'More Sorts', rows: [{ t: 'p', text: 'Use the Sort button in your inventory or den.' }] } }
}

module.exports = [menu, spammer, masterpiece, picture, sorting]
