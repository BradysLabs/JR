/*
 * JR in the game (BradysLabs).
 *
 * Runs in JR's copy of the AJ Classic app. Puts JR inside the game window:
 * a JR button on the game, a panel over the game (Plugins, Rooms, Worth,
 * Settings, Logs) and a Ctrl+K command palette. Everything it shows or does
 * goes through JR's local game server, with the token JR gave this copy of
 * the game when it opened it.
 */
(() => {
  'use strict'

  const config = () => {
    try { return (typeof globals !== 'undefined' && globals.config) || {} } catch (_) { return {} }
  }
  const ready = () => !!(config().jrApi && config().jrToken)
  const url = (p) => `${config().jrApi}${p}${p.includes('?') ? '&' : '?'}t=${encodeURIComponent(config().jrToken)}`
  const getState = async () => {
    const r = await fetch(url('/jr/ingame/state'))
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || 'JR didn’t answer')
    return d
  }
  const act = async (body) => {
    const r = await fetch(url('/jr/ingame/action'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || 'JR couldn’t do that')
    return d
  }

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
  const ago = (t) => {
    const s = Math.round((Date.now() - t) / 1000)
    return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
  }
  const num = (n) => n >= 100 ? (Math.round(n / 5) * 5).toLocaleString() : n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10)

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .root { position: absolute; inset: 0; pointer-events: none; font: 13px/1.4 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; color: #ededee; z-index: 50; }
    button { font: inherit; color: inherit; cursor: pointer; }
    input { font: inherit; color: #ededee; }

    .jr-btn { pointer-events: auto; position: absolute; left: 10px; top: 10px; height: 32px; min-width: 32px; padding: 0 10px;
      border-radius: 9px; border: 1px solid #2a2a2e; background: rgba(11,11,12,0.86); font-weight: 700; letter-spacing: 0.04em;
      font-size: 12.5px; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 14px rgba(0,0,0,0.35); }
    .jr-btn:hover { background: #ededee; color: #0b0b0c; }
    .jr-btn .dot { width: 7px; height: 7px; border-radius: 50%; background: #5b5b62; }
    .jr-btn .dot.on { background: #ededee; }
    .jr-btn:hover .dot.on { background: #0b0b0c; }

    .panel { pointer-events: auto; position: absolute; top: 10px; right: 10px; bottom: 10px; width: 352px; max-width: calc(100% - 20px);
      display: none; flex-direction: column; border-radius: 12px; border: 1px solid #1f1f22; background: rgba(11,11,12,0.97);
      box-shadow: 0 16px 40px rgba(0,0,0,0.5); overflow: hidden; }
    .panel.open { display: flex; }
    .head { display: flex; align-items: center; gap: 10px; padding: 12px 12px 10px 14px; border-bottom: 1px solid #1a1a1d; }
    .logo { width: 30px; height: 30px; border-radius: 8px; background: #ededee; color: #0b0b0c; font-weight: 800; display: grid; place-items: center; font-size: 12px; letter-spacing: 0.03em; flex: none; }
    .who { flex: 1; min-width: 0; }
    .who b { display: block; font-size: 13.5px; }
    .who span { display: block; color: #8b8b92; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .icon-btn { width: 28px; height: 28px; border-radius: 7px; border: 1px solid transparent; background: transparent; color: #a1a1a8; display: grid; place-items: center; font-size: 15px; }
    .icon-btn:hover { background: #18181b; color: #ededee; border-color: #26262a; }
    .tabs { display: flex; gap: 2px; padding: 8px 10px 0; border-bottom: 1px solid #1a1a1d; }
    .tab { flex: 1; padding: 7px 4px 9px; border: 0; background: transparent; color: #8b8b92; font-size: 12px; font-weight: 600; border-bottom: 2px solid transparent; }
    .tab:hover { color: #ededee; }
    .tab.on { color: #ededee; border-bottom-color: #ededee; }
    .body { flex: 1; overflow: auto; padding: 10px 10px 14px; }
    .body::-webkit-scrollbar { width: 8px; } .body::-webkit-scrollbar-thumb { background: #26262a; border-radius: 8px; }
    .search { width: 100%; height: 34px; border-radius: 8px; border: 1px solid #26262a; background: #0f0f11; padding: 0 10px; outline: none; margin-bottom: 10px; }
    .search:focus { border-color: #5b5b62; }
    .cat { margin: 10px 4px 4px; color: #6b6b72; font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    .row { display: flex; align-items: center; gap: 10px; padding: 8px 8px; border-radius: 8px; }
    .row:hover { background: #141416; }
    .row .txt { flex: 1; min-width: 0; }
    .row .txt b { display: block; font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row .txt span { display: block; color: #8b8b92; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pill { flex: none; height: 26px; padding: 0 10px; border-radius: 7px; border: 1px solid #2a2a2e; background: #141416; font-size: 12px; font-weight: 600; }
    .pill:hover { background: #ededee; color: #0b0b0c; border-color: #ededee; }
    .pill.primary { background: #ededee; color: #0b0b0c; border-color: #ededee; }
    .pill:disabled { opacity: 0.4; cursor: default; background: #141416; color: #ededee; border-color: #2a2a2e; }
    .tag { flex: none; font-size: 10.5px; color: #8b8b92; border: 1px solid #26262a; border-radius: 6px; padding: 1px 6px; }
    .here { color: #ededee; border-color: #5b5b62; }
    .switch { flex: none; width: 36px; height: 20px; border-radius: 20px; border: 1px solid #2a2a2e; background: #18181b; position: relative; padding: 0; }
    .switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #6b6b72; transition: left .15s; }
    .switch.on { background: #ededee; border-color: #ededee; }
    .switch.on::after { left: 18px; background: #0b0b0c; }
    .empty { color: #8b8b92; text-align: center; padding: 28px 12px; font-size: 12.5px; }
    .log { font: 11.5px/1.45 "Cascadia Mono", Consolas, monospace; color: #c8c8cd; padding: 3px 4px; border-bottom: 1px solid #141416; word-break: break-word; }
    .log .t { color: #5b5b62; margin-right: 6px; }
    .log.warn { color: #e0c27a; } .log.error { color: #f08a8a; } .log.success { color: #ededee; }
    .card { border: 1px solid #1f1f22; border-radius: 10px; padding: 12px; background: #0f0f11; margin-top: 4px; }
    .card .top { display: flex; gap: 10px; align-items: center; }
    .card img { width: 48px; height: 48px; object-fit: contain; border-radius: 8px; background: #18181b; flex: none; }
    .card .dia { font-size: 18px; font-weight: 700; margin-top: 10px; }
    .card .bl { color: #c8c8cd; font-size: 12px; }
    .card .lines { margin-top: 8px; padding-top: 8px; border-top: 1px solid #1a1a1d; }
    .card .line { color: #c8c8cd; font-size: 12px; padding: 2px 0; }
    .card .foot { color: #6b6b72; font-size: 11px; margin-top: 8px; }
    .sugg { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 7px 8px; border-radius: 7px; color: #c8c8cd; }
    .sugg:hover, .sugg.sel { background: #18181b; color: #ededee; }

    .veil { pointer-events: auto; position: absolute; inset: 0; background: rgba(0,0,0,0.45); display: none; align-items: flex-start; justify-content: center; padding-top: 12%; }
    .veil.open { display: flex; }
    .palette { width: 540px; max-width: calc(100% - 40px); border-radius: 14px; border: 1px solid #26262a; background: rgba(11,11,12,0.98); box-shadow: 0 24px 60px rgba(0,0,0,0.6); overflow: hidden; }
    .palette .search { height: 48px; border: 0; border-bottom: 1px solid #1a1a1d; border-radius: 0; margin: 0; padding: 0 16px; font-size: 15px; background: transparent; }
    .palette .list { max-height: 340px; overflow: auto; padding: 6px; }
    .palette .item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 9px 10px; border-radius: 8px; border: 0; background: transparent; }
    .palette .item.sel { background: #18181b; }
    .palette .item .kind { flex: none; width: 64px; color: #6b6b72; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .palette .item .what { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .palette .hint { color: #6b6b72; font-size: 11px; padding: 8px 14px; border-top: 1px solid #1a1a1d; display: flex; gap: 14px; }
    .toast { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); pointer-events: none; padding: 9px 14px; border-radius: 9px;
      background: rgba(11,11,12,0.95); border: 1px solid #2a2a2e; font-size: 12.5px; opacity: 0; transition: opacity .2s; max-width: 80%; }
    .toast.show { opacity: 1; } .toast.err { border-color: #7a3b3b; color: #f2b8b8; }
  `

  const TABS = [['plugins', 'Plugins'], ['rooms', 'Rooms'], ['worth', 'Worth'], ['settings', 'Settings'], ['logs', 'Logs']]

  function mount (container, webview) {
    if (container.querySelector('#jr-ingame')) return
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
    const host = el('div'); host.id = 'jr-ingame'
    host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:50;'
    const shadow = host.attachShadow({ mode: 'open' })
    const style = el('style'); style.textContent = CSS
    const root = el('div', 'root')
    shadow.append(style, root)
    container.appendChild(host)

    // JR's rows in the game's own Settings window: the game page keeps a copy
    // (it needs one the moment the window opens); switching one comes back here.
    // Each row reuses one of AJ's own icons.
    const ICONS = { antiKick: 'autoServer', tradeHelper: 'buddyRequest', worthBubble: 'predictTxt', worthInNames: 'predictTxt', notifications: 'doorBell' }
    let sendError = null
    const sendRows = (s) => {
      if (!s || !Array.isArray(s.settings)) return
      try {
        webview.send('jrSettings', s.settings.map(x => ({
          type: 0, frame: ICONS[x.key] || 'autoServer', labelTxt: x.short || x.label, onTxt: 'On', offTxt: 'Off', key: 'jr:' + x.key, value: !!x.value
        })))
      } catch (e) {
        // the game page isn't ready yet; sent again on dom-ready
        if (sendError !== e.message) { sendError = e.message; act({ action: 'log', message: `Couldn't pass Settings rows to the game page yet: ${e.message}` }).catch(() => {}) }
      }
    }
    webview.addEventListener('dom-ready', () => { act({ action: 'log', message: 'Game page ready.' }).catch(() => {}); sendRows(state) })
    webview.addEventListener('ipc-message', (event) => {
      if (event.channel === 'jrDebug') { act({ action: 'log', message: String(event.args[0] || '') }).catch(() => {}); return }
      if (event.channel !== 'jrSettingToggle') return
      const key = String(event.args[0] || '')
      if (!key.startsWith('jr:')) return
      act({ action: 'setting', key: key.slice(3), value: !!event.args[1] })
        .then(() => refresh())
        .catch((e) => { say(e.message, true); refresh() })
    })

    let state = null
    let tab = 'plugins'
    let pluginQuery = ''
    let worthQuery = ''
    let worthResult = null
    let worthSuggestions = []
    let timer = null

    /* ---- JR button ---- */
    const btn = el('button', 'jr-btn')
    const dot = el('span', 'dot')
    btn.append(dot, el('span', null, 'JR'))
    btn.title = 'JR (Ctrl+K for commands)'
    btn.onclick = () => (panel.classList.contains('open') ? closePanel() : openPanel())

    /* ---- toast ---- */
    const toast = el('div', 'toast')
    let toastTimer = null
    const say = (text, isError) => {
      toast.textContent = text
      toast.className = 'toast show' + (isError ? ' err' : '')
      clearTimeout(toastTimer)
      toastTimer = setTimeout(() => { toast.className = 'toast' + (isError ? ' err' : '') }, 2600)
    }
    const run = (fn) => async (...args) => { try { await fn(...args) } catch (e) { say(e.message, true) } }

    /* ---- panel ---- */
    const panel = el('div', 'panel')
    const head = el('div', 'head')
    const who = el('div', 'who')
    const whoName = el('b', null, 'JR')
    const whoLine = el('span', null, 'Connecting to JR…')
    who.append(whoName, whoLine)
    const showJR = el('button', 'icon-btn', '↗'); showJR.title = 'Open the JR window'
    showJR.onclick = run(async () => { await act({ action: 'showJR' }) })
    const close = el('button', 'icon-btn', '✕'); close.title = 'Close (Esc)'
    close.onclick = () => closePanel()
    head.append(el('div', 'logo', 'JR'), who, showJR, close)
    const tabs = el('div', 'tabs')
    const tabButtons = {}
    for (const [id, label] of TABS) {
      const t = el('button', 'tab', label)
      t.onclick = () => { tab = id; render() }
      tabButtons[id] = t
      tabs.appendChild(t)
    }
    const body = el('div', 'body')
    panel.append(head, tabs, body)

    /* ---- palette ---- */
    const veil = el('div', 'veil')
    const palette = el('div', 'palette')
    const pInput = el('input', 'search'); pInput.placeholder = 'Search plugins, rooms, settings and item worth…'
    const pList = el('div', 'list')
    const pHint = el('div', 'hint')
    pHint.append(el('span', null, '↑↓ to move'), el('span', null, 'Enter to run'), el('span', null, 'Esc to close'))
    palette.append(pInput, pList, pHint)
    veil.appendChild(palette)
    veil.addEventListener('mousedown', (e) => { if (e.target === veil) closePalette() })
    let pItems = []
    let pSel = 0

    // JR's buttons live inside the game now; this page keeps the Ctrl+K palette.
    root.append(panel, veil, toast)

    /* ---- data ---- */
    const refresh = async () => {
      try {
        state = await getState()
        dot.classList.toggle('on', !!state.connected)
        sendRows(state)
      } catch (e) {
        state = null
      }
      render()
      if (veil.classList.contains('open')) renderPalette()
    }
    const startPolling = () => { if (!timer) timer = setInterval(refresh, 2000) }
    const stopPolling = () => { if (timer && !panel.classList.contains('open') && !veil.classList.contains('open')) { clearInterval(timer); timer = null } }

    function openPanel (which) {
      if (which) tab = which
      panel.classList.add('open')
      refresh()
      startPolling()
    }
    function closePanel () {
      panel.classList.remove('open')
      stopPolling()
      try { webview.focus() } catch (_) {}
    }
    function openPalette () {
      veil.classList.add('open')
      pInput.value = ''
      pSel = 0
      refresh()
      startPolling()
      renderPalette()
      setTimeout(() => pInput.focus(), 0)
    }
    function closePalette () {
      veil.classList.remove('open')
      stopPolling()
      try { webview.focus() } catch (_) {}
    }

    /* ---- panel views ---- */
    function render () {
      for (const [id] of TABS) tabButtons[id].classList.toggle('on', id === tab)
      if (!state) {
        whoName.textContent = 'JR'
        whoLine.textContent = 'JR isn’t answering. Is the JR window open?'
        body.replaceChildren(el('div', 'empty', 'JR isn’t answering right now.'))
        return
      }
      whoName.textContent = `JR ${state.version} · ${state.profile}`
      whoLine.textContent = state.connected
        ? [state.server, state.room].filter(Boolean).join(' · ') || 'Connected'
        : 'Not connected to Animal Jam'
      if (!panel.classList.contains('open')) return
      const keepScroll = body.scrollTop
      const active = shadow.activeElement
      const focused = active && active.dataset ? active.dataset.keep : null
      body.replaceChildren(...({ plugins: viewPlugins, rooms: viewRooms, worth: viewWorth, settings: viewSettings, logs: viewLogs }[tab])())
      body.scrollTop = tab === 'logs' ? body.scrollHeight : keepScroll
      if (focused) {
        const again = body.querySelector(`[data-keep="${focused}"]`)
        if (again) { again.focus(); try { again.setSelectionRange(again.value.length, again.value.length) } catch (_) {} }
      }
    }

    const statusText = (s) => ({ off: 'Turned off in JR', 'needs-approval': 'Waiting for your OK in JR', changed: 'Changed; needs your OK in JR', error: 'Has an error; see JR' }[s] || s)

    function viewPlugins () {
      const input = el('input', 'search'); input.placeholder = 'Search plugins'; input.value = pluginQuery; input.dataset.keep = 'plugins'
      input.oninput = () => { pluginQuery = input.value; render() }
      const q = pluginQuery.toLowerCase().trim()
      const list = state.plugins.filter(p => !q || `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q))
      const out = [input]
      if (!list.length) return [...out, el('div', 'empty', 'No plugins match.')]
      const pinned = list.filter(p => state.pinned.includes(p.id))
      const groups = new Map()
      if (pinned.length && !q) groups.set('Pinned', pinned)
      for (const p of list) { const c = p.category || 'Other'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(p) }
      for (const [name, items] of groups) {
        out.push(el('div', 'cat', name))
        for (const p of items) {
          const row = el('div', 'row')
          const txt = el('div', 'txt'); txt.append(el('b', null, p.name), el('span', null, p.status === 'ready' ? p.description : statusText(p.status)))
          const b = el('button', 'pill' + (p.open ? '' : ' primary'), p.open ? 'Show' : 'Open')
          b.disabled = p.status !== 'ready'
          b.onclick = run(async () => { await act({ action: 'openPlugin', id: p.id }); say(`${p.name} opened.`); refresh() })
          row.append(txt, b)
          out.push(row)
        }
      }
      return out
    }

    function viewRooms () {
      if (!state.connected) return [el('div', 'empty', 'Log in to Animal Jam to see your rooms.')]
      if (!state.rooms.length) return [el('div', 'empty', 'Rooms you visit show up here.')]
      const out = [el('div', 'cat', 'Since you logged in')]
      state.rooms.forEach((r, i) => {
        const row = el('div', 'row')
        const txt = el('div', 'txt'); txt.append(el('b', null, r.title), el('span', null, [r.detail, ago(r.at)].filter(Boolean).join(' · ')))
        row.appendChild(txt)
        if (i === 0) row.appendChild(el('span', 'tag here', 'Here'))
        else {
          const b = el('button', 'pill', 'Go')
          b.onclick = run(async () => { await act({ action: 'joinRoom', name: r.name }); say(`Going to ${r.title}…`) })
          row.appendChild(b)
        }
        out.push(row)
      })
      return out
    }

    let worthTimer = null
    const loadWorth = async (name) => {
      const d = await act({ action: 'worth', name })
      worthSuggestions = d.suggestions || []
      worthResult = d.result && d.result.matched ? d.result : null
      render()
    }
    function viewWorth () {
      const input = el('input', 'search'); input.placeholder = 'Item name, like Rare Spiked Collar'; input.value = worthQuery; input.dataset.keep = 'worth'
      input.oninput = () => {
        worthQuery = input.value
        clearTimeout(worthTimer)
        worthTimer = setTimeout(run(() => loadWorth(worthQuery)), 180)
      }
      input.onkeydown = (e) => { if (e.key === 'Enter' && worthSuggestions[0]) pickWorth(worthSuggestions[0]) }
      const out = [input]
      if (worthResult) out.push(worthCard(worthResult))
      const others = worthSuggestions.filter(s => !worthResult || s !== worthResult.name)
      if (others.length) {
        out.push(el('div', 'cat', worthResult ? 'Other items' : 'Items'))
        for (const s of others) { const b = el('button', 'sugg', s); b.onclick = () => pickWorth(s); out.push(b) }
      }
      if (!worthQuery.trim()) out.push(el('div', 'empty', 'Type an item name to see its worth from the Item Worth Wiki.'))
      else if (!worthResult && !worthSuggestions.length) out.push(el('div', 'empty', 'Nothing on the wiki by that name.'))
      return out
    }
    const pickWorth = run(async (name) => { worthQuery = name; tab = 'worth'; await loadWorth(name) })
    function worthCard (d) {
      const card = el('div', 'card')
      const top = el('div', 'top')
      if (d.image) { const img = el('img'); img.src = d.image; img.alt = ''; top.appendChild(img) }
      const t = el('div'); t.append(el('b', null, d.name))
      const scope = { color: 'This color', 'all colors': 'Range across all colors', 'all versions': 'Range across all versions' }[d.scope]
      if (scope || d.color) t.append(el('div', 'bl', [d.color, scope].filter(Boolean).join(' · ')))
      top.appendChild(t)
      card.appendChild(top)
      if (d.diamonds) {
        const a = num(d.diamonds.min); const b = num(d.diamonds.max)
        card.appendChild(el('div', 'dia', `≈ ${a === b ? a : `${a}–${b}`} Diamonds`))
        if (d.bl >= 0.1) card.appendChild(el('div', 'bl', `≈ ${d.bl >= 10 ? Math.round(d.bl) : Math.round(d.bl * 10) / 10} Black Long collars`))
      }
      const lines = el('div', 'lines')
      for (const l of d.lines || []) lines.appendChild(el('div', 'line', l))
      if (d.more) lines.appendChild(el('div', 'foot', `+${d.more} more on the wiki`))
      card.appendChild(lines)
      card.appendChild(el('div', 'foot', `Item Worth Wiki${d.updated ? ` · updated ${d.updated}` : ''}`))
      return card
    }

    function viewSettings () {
      const out = [el('div', 'cat', 'This profile')]
      for (const s of state.settings) {
        const row = el('div', 'row')
        const txt = el('div', 'txt'); txt.append(el('b', null, s.label), el('span', null, s.detail))
        const sw = el('button', 'switch' + (s.value ? ' on' : ''))
        sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', String(s.value)); sw.setAttribute('aria-label', s.label)
        sw.onclick = run(async () => { await act({ action: 'setting', key: s.key, value: !s.value }); await refresh() })
        row.append(txt, sw)
        out.push(row)
      }
      return out
    }

    function viewLogs () {
      if (!state.logs.length) return [el('div', 'empty', 'Nothing yet.')]
      return state.logs.map(e => {
        const line = el('div', `log ${e.type}`)
        line.append(el('span', 't', new Date(e.t).toTimeString().slice(0, 8)), document.createTextNode(e.message))
        return line
      })
    }

    /* ---- palette ---- */
    function paletteItems (q) {
      const items = []
      const query = q.toLowerCase().trim()
      const hit = (text) => !query || text.toLowerCase().includes(query)
      if (state) {
        for (const p of state.plugins) if (p.status === 'ready' && hit(`${p.name} ${p.description}`)) items.push({ kind: 'Plugin', what: p.name, go: async () => { await act({ action: 'openPlugin', id: p.id }); say(`${p.name} opened.`) } })
        for (const [i, r] of state.rooms.entries()) if (i > 0 && hit(`${r.title} ${r.name}`)) items.push({ kind: 'Room', what: `Go to ${r.title}`, go: async () => { await act({ action: 'joinRoom', name: r.name }); say(`Going to ${r.title}…`) } })
        for (const s of state.settings) if (hit(s.label)) items.push({ kind: 'Setting', what: `Turn ${s.label} ${s.value ? 'off' : 'on'}`, go: async () => { await act({ action: 'setting', key: s.key, value: !s.value }); say(`${s.label} ${s.value ? 'off' : 'on'}.`) } })
      }
      for (const [id, label] of TABS) if (hit(`${label} panel`)) items.push({ kind: 'JR', what: `Show ${label}`, go: async () => openPanel(id) })
      if (hit('open jr window')) items.push({ kind: 'JR', what: 'Open the JR window', go: async () => act({ action: 'showJR' }) })
      if (query.length >= 2) items.push({ kind: 'Worth', what: `Worth of “${q.trim()}”`, go: async () => { openPanel('worth'); worthQuery = q.trim(); await loadWorth(q.trim()) } })
      return items.slice(0, 40)
    }
    function renderPalette () {
      pItems = paletteItems(pInput.value)
      if (pSel >= pItems.length) pSel = Math.max(0, pItems.length - 1)
      pList.replaceChildren(...(pItems.length ? pItems.map((it, i) => {
        const b = el('button', 'item' + (i === pSel ? ' sel' : ''))
        b.append(el('span', 'kind', it.kind), el('span', 'what', it.what))
        b.onmouseenter = () => { pSel = i; renderSel() }
        b.onclick = () => choose(i)
        return b
      }) : [el('div', 'empty', state ? 'Nothing matches.' : 'JR isn’t answering right now.')]))
    }
    function renderSel () {
      ;[...pList.children].forEach((c, i) => c.classList && c.classList.toggle('sel', i === pSel))
      const sel = pList.children[pSel]
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' })
    }
    const choose = run(async (i) => {
      const it = pItems[i]
      if (!it) return
      closePalette()
      await it.go()
    })
    pInput.addEventListener('input', () => { pSel = 0; renderPalette() })
    pInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { pSel = Math.min(pItems.length - 1, pSel + 1); renderSel(); e.preventDefault() } else if (e.key === 'ArrowUp') { pSel = Math.max(0, pSel - 1); renderSel(); e.preventDefault() } else if (e.key === 'Enter') { choose(pSel); e.preventDefault() } else if (e.key === 'Escape') { closePalette(); e.preventDefault() }
    })
    shadow.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('open') && !veil.classList.contains('open')) closePanel()
    })

    window.jrIngame = {
      palette: () => (veil.classList.contains('open') ? closePalette() : openPalette()),
      toggle: () => (panel.classList.contains('open') ? closePanel() : openPanel()),
      open: openPanel,
      say: (text, isError) => say(String(text), !!isError)
    }
    // Ctrl+K while this page has the keyboard (when the game has it, JR's
    // copy of the app catches the keys and calls jrIngame.palette()).
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); window.jrIngame.palette() }
    }, true)
    refresh()
    // Keep the button's connection dot current while the panel is closed.
    setInterval(() => { if (!timer) getState().then(s => { state = s; dot.classList.toggle('on', !!s.connected); sendRows(s) }).catch(() => {}) }, 10000)
  }

  // The game screen is built after this script runs; wait for it.
  const look = () => {
    if (!ready()) return false
    const screen = document.querySelector('ajd-game-screen')
    const container = screen && screen.shadowRoot && screen.shadowRoot.getElementById('flash-game-container')
    const webview = container && container.querySelector('webview')
    if (!container || !webview) return false
    mount(container, webview)
    return true
  }
  const wait = setInterval(() => { if (look()) clearInterval(wait) }, 500)
})()
