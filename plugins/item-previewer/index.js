/*
 * Item Previewer - try on any clothing item, on your screen only.
 *
 * How it works (from real captures):
 *
 *   you send   %xt%o%iu%<room>%<# put on>%<# taken off>%<slots put on...>%<slots taken off...>%
 *   server     %xt%il%-1%3%0%<animal>%<username>%0%<# put on>%<# taken off>%
 *                  <slot>%<item id>% for each item put on, then <slot>% for each taken off
 *   e.g. put on slot 3:   iu ...%1%0%3%   ->  il ...%0%1%0%3%393%
 *        take off slot 3: iu ...%0%1%3%   ->  il ...%0%0%1%3%
 *
 *   added to inventory (after buying):
 *              %xt%il%-1%2%1%<animal>%<username>%<COLOR>%1%0%<slot>%<item id>%
 *   COLOR is one of the packed values in the item's "colors" field in the
 *   clothing data (pack 1000), e.g. Necklace color 1 = 5580347.
 *
 * We send the game our own "added" (made-up inventory slot, chosen color)
 * and then an update that puts it on. Nothing goes to the server. When you
 * put a preview on / take it off in the game, the "iu" is cleaned of
 * preview slots here and answered locally, so the server never sees a slot
 * it doesn't know.
 */
(async function () {
  // Preview items use slots far above any real inventory slot.
  const FAKE_SLOT_BASE = 900000
  const MAX_ROWS = 300
  const REAPPLY_DELAY = 1500

  const $ = id => document.getElementById(id)
  const listEl = $('list')
  const searchEl = $('search')
  const countEl = $('count')
  const statusEl = $('status')
  const dotEl = $('dot')
  const colorEl = $('color')
  const inventoryNumberEl = $('inventoryNumber')
  const previewBtn = $('preview')
  const activeEl = $('active')
  const removeAllBtn = $('removeAll')
  const keepEl = $('keep')

  const jam = await new Promise(resolve => {
    if (window.jam && window.jam.dispatch) return resolve(window.jam)
    const timer = setInterval(() => {
      if (window.jam && window.jam.dispatch) { clearInterval(timer); resolve(window.jam) }
    }, 50)
  })
  const { dispatch, application } = jam

  let items = []            // [{ id, name, members }]
  let selected = null
  let me = null             // { animal, username } from your own real "il"
  let lastOwnWear = 0       // when you last put on / took off a real item
  let nextSlot = FAKE_SLOT_BASE
  const previews = new Map() // slot -> { slot, id, name, color, worn }

  // ---------------------------------------------------------------- helpers

  function setStatus (text, kind = '') {
    statusEl.textContent = text
    statusEl.className = kind
    dotEl.className = 'dot' + (kind === 'ok' ? ' live' : kind === 'warn' ? ' warn' : '')
  }

  function escapeHtml (value) {
    return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function myName () {
    try {
      const player = dispatch.getState('player')
      if (player && typeof player === 'object') {
        const name = player.username || player.userName || player.screenName || player.name
        if (typeof name === 'string' && name) return name.toLowerCase()
      }
    } catch (_) {}
    return null
  }

  function updateReady () {
    if (me) {
      setStatus('Ready', 'ok')
    } else {
      setStatus('Put on or take off any item in the game once so I can find your animal.', 'warn')
    }
    renderSelected()
  }

  // Puts preview items on / takes them off, on your game only.
  function sendToGame (entries) {
    if (!me) throw new Error('Your animal isn\'t known yet.')
    const on = entries.filter(e => e.worn)
    const off = entries.filter(e => !e.worn)
    const fields = ['', 'xt', 'il', -1, 3, 0, me.animal, me.username, 0, on.length, off.length]
    on.forEach(e => fields.push(e.slot, e.id))
    off.forEach(e => fields.push(e.slot))
    dispatch.sendConnectionMessage(fields.join('%') + '%')
  }

  // Adds a preview item to your inventory, on your game only.
  function addToGame (e) {
    if (!me) throw new Error('Your animal isn\'t known yet.')
    // Same as a real purchase: the color goes in the header, the item is
    // added "off" and put on with a separate update.
    const fields = ['', 'xt', 'il', -1, 2, 1, me.animal, me.username, e.colorValue, 1, 0, e.slot, e.id]
    dispatch.sendConnectionMessage(fields.join('%') + '%')
  }

  // ---------------------------------------------------------------- packets

  // Your own clothing update: learn the fields that identify you + your animal.
  dispatch.onMessage({
    type: 'aj',
    message: 'il',
    callback: ({ message }) => {
      const parts = message.value
      if (!Array.isArray(parts) || parts.length < 10) return
      const username = String(parts[7] || '').toLowerCase()
      const loginName = myName()
      const mine = (loginName && username === loginName) || Date.now() - lastOwnWear < 3000
      if (!mine) return

      const isNewAnimal = !me || me.animal !== parts[6]
      me = { animal: parts[6], username: parts[7] }
      if (isNewAnimal) updateReady()
    }
  })

  // Putting on / taking off. Preview slots are handled here; real ones go
  // through to the server.
  //   %xt%o%iu%<room>%<# put on>%<# taken off>%<slots put on...>%<slots taken off...>%
  dispatch.onMessage({
    type: 'connection',
    message: 'iu',
    callback: ({ message }) => {
      const parts = message.value
      const end = parts[parts.length - 1] === '' ? parts.length - 1 : parts.length
      const onCount = parseInt(parts[5], 10) || 0
      const offCount = parseInt(parts[6], 10) || 0
      const putOn = parts.slice(7, 7 + onCount).map(Number)
      const takenOff = parts.slice(7 + onCount, Math.min(end, 7 + onCount + offCount)).map(Number)
      const isPreview = slot => previews.has(slot)

      if (!putOn.concat(takenOff).some(isPreview)) {
        lastOwnWear = Date.now()
        return
      }

      // Update the preview items on your game.
      const changed = []
      putOn.filter(isPreview).forEach(slot => {
        const p = previews.get(slot)
        p.worn = true
        changed.push(p)
      })
      takenOff.filter(isPreview).forEach(slot => {
        const p = previews.get(slot)
        p.worn = false
        changed.push(p)
      })
      try { sendToGame(changed) } catch (error) { setStatus(error.message, 'error') }

      // Send only the real items on to the server (or nothing at all).
      const realOn = putOn.filter(slot => !isPreview(slot))
      const realOff = takenOff.filter(slot => !isPreview(slot))
      if (realOn.length || realOff.length) {
        message.value = [...parts.slice(0, 5), realOn.length, realOff.length, ...realOn, ...realOff, '']
        lastOwnWear = Date.now()
      } else {
        message.send = false
        dispatch.sendConnectionMessage(`%xt%iu%${parts[4]}%1%`)
      }
      renderActive()
    }
  })


  // Changing rooms shows your real outfit again; put previews back on.
  dispatch.onMessage({
    type: 'aj',
    message: 'rj',
    callback: () => {
      if (!keepEl.checked) return
      const worn = [...previews.values()].filter(p => p.worn)
      if (!worn.length) return
      setTimeout(() => {
        try { sendToGame(worn) } catch (_) {}
      }, REAPPLY_DELAY)
    }
  })

  // ---------------------------------------------------------------- actions

  function tryOn () {
    if (!selected) return
    const inventoryNumber = Number(inventoryNumberEl.value)
    if (!Number.isInteger(inventoryNumber) || inventoryNumber < 1 || inventoryNumber > 1000) {
      setStatus('Enter this item’s inventory number (1–1000) to label the preview.', 'warn')
      inventoryNumberEl.focus()
      return
    }
    const option = Math.max(0, parseInt(colorEl.value, 10) || 0)
    const colorValue = selectedColors.length ? selectedColors[Math.min(option, selectedColors.length - 1)] : 0
    const preview = { slot: nextSlot++, id: selected.id, name: selected.name, inventoryNumber, color: option + 1, colorValue, worn: true }
    try {
      addToGame(preview)
      sendToGame([preview])
      previews.set(preview.slot, preview)
      setStatus(`Trying on ${selected.name}`, 'ok')
    } catch (error) {
      setStatus(error.message, 'error')
    }
    renderActive()
  }

  function setWorn (slot, worn) {
    const preview = previews.get(slot)
    if (!preview) return
    preview.worn = worn
    try { sendToGame([preview]) } catch (error) { setStatus(error.message, 'error') }
    renderActive()
  }

  function takeAllOff () {
    const worn = [...previews.values()].filter(p => p.worn)
    worn.forEach(p => { p.worn = false })
    if (worn.length) {
      try { sendToGame(worn) } catch (error) { setStatus(error.message, 'error') }
    }
    renderActive()
  }

  // ---------------------------------------------------------------- UI

  function renderList () {
    const query = searchEl.value.trim().toLowerCase()
    const matches = query
      ? items.filter(i => i.name.toLowerCase().includes(query) || String(i.id) === query)
      : items
    const shown = matches.slice(0, MAX_ROWS)

    countEl.textContent = matches.length > MAX_ROWS
      ? `Showing ${MAX_ROWS} of ${matches.length.toLocaleString()} - search to narrow it down`
      : `${matches.length.toLocaleString()} item${matches.length === 1 ? '' : 's'}`

    if (!shown.length) {
      listEl.innerHTML = `<div class="empty">${items.length ? 'No items match.' : 'No item names loaded.'}</div>`
      return
    }

    listEl.innerHTML = shown.map(i => `
      <div class="row${selected && selected.id === i.id ? ' selected' : ''}" data-id="${i.id}" role="option">
        <span class="name">${escapeHtml(i.name)}</span>
        ${i.members ? '<span class="tag">Member</span>' : ''}
        <span class="id">#${i.id}</span>
      </div>`).join('')
  }

  // ---------------------------------------------------------------- colors
  //
  // An item's colors are in the raw clothing data (pack 1000): "colors" is
  // a comma-separated list of packed color values, one per color the item
  // comes in. The game sends that value (as a signed 32-bit number) when the
  // item is added, e.g. Necklace colors 1-8 = 5580347, 1395070247, ...

  const CLOTHING_PACK = '1000'
  let selectedColors = []   // packed color values of the selected item
  let clothingPack = null
  let colorRequest = 0

  function loadClothingPack () {
    if (!clothingPack) {
      const db = application.items
      clothingPack = Promise.resolve()
        .then(() => db.deployVersion || (db.load && db.load()))
        .then(() => db.fetchPack(db.deployVersion, CLOTHING_PACK))
        .catch(error => { clothingPack = null; throw error })
    }
    return clothingPack
  }

  function rawEntry (pack, id) {
    if (!pack || typeof pack !== 'object') return null
    if (!Array.isArray(pack) && pack[id] && typeof pack[id] === 'object') return pack[id]
    return Object.values(pack).find(e => e && String(e.id) === String(id)) || null
  }

  function colorValues (entry) {
    const raw = entry && entry.colors
    if (raw === undefined || raw === null || raw === '') return []
    return String(raw).split(',')
      .map(v => Number(v.trim()))
      .filter(Number.isFinite)
      .map(v => v | 0) // same signed form the game uses
  }

  function markSwatch () {
    const current = String(parseInt(colorEl.value, 10) || 0)
    document.querySelectorAll('.swatch').forEach(el => el.classList.toggle('active', el.dataset.send === current))
  }

  async function renderColors () {
    const swatchesEl = $('swatches')
    const noteEl = $('colorNote')
    swatchesEl.innerHTML = ''
    noteEl.textContent = ''
    colorEl.value = 0
    selectedColors = []
    if (!selected) return

    const request = ++colorRequest
    noteEl.textContent = 'Loading colors...'
    let entry = null
    try {
      entry = rawEntry(await loadClothingPack(), selected.id)
    } catch (error) {
      if (request === colorRequest) noteEl.textContent = `Couldn't load this item's colors (${error.message}). Type a color number instead.`
      return
    }
    if (request !== colorRequest) return

    selectedColors = colorValues(entry)
    if (!selectedColors.length) {
      noteEl.textContent = 'No color info for this item; it will use its default color.'
      return
    }

    selectedColors.forEach((value, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'swatch index'
      button.dataset.send = index
      button.textContent = index + 1
      button.title = `Color ${index + 1} (${value})`
      button.addEventListener('click', () => { colorEl.value = index; markSwatch() })
      swatchesEl.appendChild(button)
    })
    noteEl.textContent = selectedColors.length === 1
      ? 'This item only comes in one color.'
      : `${selectedColors.length} colors. Pick one, then Try it on.`
    colorEl.value = 0
    markSwatch()
  }

  function renderSelected () {
    $('selName').textContent = selected ? selected.name : 'Pick an item'
    $('selMeta').textContent = selected ? `Item #${selected.id}${selected.members ? ' · members' : ''}` : ''
    previewBtn.disabled = !selected || !me
  }

  function renderActive () {
    const all = [...previews.values()]
    removeAllBtn.disabled = !all.some(p => p.worn)
    if (!all.length) {
      activeEl.innerHTML = '<div class="empty">Nothing yet.</div>'
      return
    }
    activeEl.innerHTML = all.map(p => `
      <div class="active-row">
        <span class="name" title="Inventory #${p.inventoryNumber}: ${escapeHtml(p.name)}">#${p.inventoryNumber} · ${escapeHtml(p.name)}</span>
        <span class="state${p.worn ? ' on' : ''}">${p.worn ? 'wearing' : 'off'} · color ${p.color}</span>
        <button class="btn small" data-slot="${p.slot}" data-worn="${p.worn ? 0 : 1}">${p.worn ? 'Take off' : 'Put on'}</button>
      </div>`).join('')
  }

  listEl.addEventListener('click', event => {
    const row = event.target.closest('.row')
    if (!row) return
    selected = items.find(i => i.id === Number(row.dataset.id)) || null
    // Just move the highlight; rebuilding the list would break double-click.
    listEl.querySelectorAll('.row.selected').forEach(r => r.classList.remove('selected'))
    row.classList.add('selected')
    renderSelected()
    renderColors()
  })
  listEl.addEventListener('dblclick', event => { if (event.target.closest('.row') && !previewBtn.disabled) tryOn() })

  activeEl.addEventListener('click', event => {
    const button = event.target.closest('button[data-slot]')
    if (button) setWorn(Number(button.dataset.slot), button.dataset.worn === '1')
  })

  let searchTimer = null
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(renderList, 120)
  })
  previewBtn.addEventListener('click', tryOn)
  removeAllBtn.addEventListener('click', takeAllOff)
  colorEl.addEventListener('input', () => markSwatch())

  // Closing the window takes preview items off (the packet hooks are removed
  // by Jam when the window closes).
  window.addEventListener('beforeunload', () => {
    try { takeAllOff() } catch (_) {}
  })

  // ---------------------------------------------------------------- start

  async function loadItems () {
    const db = application && application.items
    if (!db) throw new Error('Item names are not available in this version of Jam.')
    if (!db.ready && typeof db.load === 'function') await db.load()
    items = [...db.clothing.entries()]
      .map(([id, item]) => ({ id: Number(id), name: (item && item.name) || `Item #${id}`, members: Boolean(item && item.members) }))
      .filter(i => Number.isFinite(i.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  updateReady()
  try {
    await loadItems()
  } catch (error) {
    countEl.textContent = `Couldn't load item names: ${error.message}`
  }
  renderList()
  renderActive()
})()
