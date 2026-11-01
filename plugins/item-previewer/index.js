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
  const MAX_ROWS = 300

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
  const path = require('path')
  const root = path.resolve(__dirname, '..', '..')
  const { createThumbs } = require(path.join(root, 'src', 'ui', 'thumbs.js'))
  const { itemMatcher } = require(path.join(root, 'src', 'game', 'search.js'))
  const pictures = application && application.pictures
  const thumbs = createThumbs({ pictures, scroller: listEl })

  // Worth, from the Item Worth Wiki (same as Inventory Worth).
  let pricer = null
  function getPricer () {
    const db = application && application.items
    if (pricer || !db || !db.ready) return pricer
    try { pricer = require(path.join(root, 'src', 'worth', 'pricer.js')).createPricer({ root, items: db }) } catch (_) {}
    return pricer
  }

  // A clothing item's first color, for its picture in the list.
  function firstColor (id) {
    const def = application && application.items && application.items.getClothing(id)
    return def && Array.isArray(def.colors) && def.colors.length ? (Number(def.colors[0]) >>> 0) : 0
  }

  let items = []            // [{ id, name, members }]
  let selected = null
  // JR keeps one set of clothing previews (tryon.js), shared with the Try On
  // window in the game and kept per account for next time.
  const { ClothingPreviews } = require(path.join(__dirname, 'tryon.js'))
  const shared = application && application.clothingPreviews
  const cp = shared || new ClothingPreviews({ dispatch, myName: () => myName() })
  const stopWatching = cp.watch(() => { renderActive(); if (cp.ready !== wasReady) { wasReady = cp.ready; updateReady() } })
  let wasReady = cp.ready

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
    if (cp.ready) {
      setStatus('Ready', 'ok')
    } else {
      setStatus('Put on or take off any item in the game once so I can find your animal.', 'warn')
    }
    renderSelected()
  }

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
    try {
      cp.add({ id: selected.id, name: selected.name, colorIndex: option, colorValue, inventoryNumber })
      setStatus(`Trying on ${selected.name}. It stays in your items next time you log in.`, 'ok')
    } catch (error) {
      setStatus(error.message, 'error')
    }
  }

  function setWorn (slot, worn) {
    try { cp.setWorn(slot, worn) } catch (error) { setStatus(error.message, 'error') }
  }

  function takeAllOff () {
    try { cp.takeAllOff() } catch (error) { setStatus(error.message, 'error') }
  }

  // ---------------------------------------------------------------- UI

  function renderList () {
    const query = searchEl.value.trim().toLowerCase()
    const matches = query
      ? items.filter((match => i => match(i.name, i.id))(itemMatcher(query)))
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
        <span class="thumbBox"><img class="thumb" alt="" data-kind="clothing" data-id="${i.id}" data-color="${firstColor(i.id)}"></span>
        <span class="name">${escapeHtml(i.name)}</span>
        ${i.members ? '<span class="tag">Member</span>' : ''}
        <span class="id">#${i.id}</span>
      </div>`).join('')
    listEl.scrollTop = 0
    thumbs.watch()
  }

  // The selected item's picture (in the chosen color) and worth.
  function renderLook () {
    const pic = $('pic')
    $('worth').textContent = ''
    $('worthNote').textContent = ''
    pic.innerHTML = ''
    if (!selected) return
    const option = Math.max(0, parseInt(colorEl.value, 10) || 0)
    const color = selectedColors.length ? (selectedColors[Math.min(option, selectedColors.length - 1)] >>> 0) : firstColor(selected.id)
    if (pictures) {
      pic.innerHTML = `<img class="thumb" alt="" data-kind="clothing" data-id="${selected.id}" data-color="${color}">`
      thumbs.show(pic.querySelector('img'))
    } else {
      pic.textContent = 'Pictures show once you\u2019re in the game.'
    }
    const p = getPricer()
    let v = null
    try { v = p && p.value({ kind: 'clothing', id: selected.id, color }) } catch (_) {}
    if (!v) return
    if (v.diamonds) $('worth').textContent = p.format(v.diamonds)
    else if (v.status === 'store') $('worth').textContent = v.store ? `In stores · ${v.store.cost.toLocaleString()} ${v.store.currency}` : 'In stores'
    else if (v.store) $('worth').textContent = `Store price · ${v.store.cost.toLocaleString()} ${v.store.currency}`
    else if (v.text) $('worth').textContent = v.text.slice(0, 80)
    else $('worth').textContent = 'No worth listed'
    $('worthNote').textContent = v.diamonds || v.text ? `Item Worth Wiki${v.color ? ` · ${v.color}` : ''}${v.text ? ` · ${v.text.slice(0, 120)}` : ''}` : v.store ? 'Not on the Item Worth Wiki' : ''
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
      button.addEventListener('click', () => { colorEl.value = index; markSwatch(); renderLook() })
      swatchesEl.appendChild(button)
    })
    noteEl.textContent = selectedColors.length === 1
      ? 'This item only comes in one color.'
      : `${selectedColors.length} colors. Pick one, then Try it on.`
    colorEl.value = 0
    markSwatch()
    renderLook()
  }

  function renderSelected () {
    $('selName').textContent = selected ? selected.name : 'Pick an item'
    $('selMeta').textContent = selected ? `Item #${selected.id}${selected.members ? ' · members' : ''}` : ''
    previewBtn.disabled = !selected || !cp.ready
    renderLook()
  }

  function renderActive () {
    const all = cp.list()
    removeAllBtn.disabled = !all.some(p => p.worn)
    if (!all.length) {
      activeEl.innerHTML = '<div class="empty">Nothing yet.</div>'
      return
    }
    activeEl.innerHTML = all.map(p => `
      <div class="active-row">
        <span class="name" title="${p.inventoryNumber ? `Inventory #${p.inventoryNumber}: ` : ''}${escapeHtml(p.name)}">${p.inventoryNumber ? `#${p.inventoryNumber} · ` : ''}${escapeHtml(p.name)}</span>
        <span class="state${p.worn ? ' on' : ''}">${p.worn ? 'wearing' : 'off'} · color ${p.colorIndex + 1}</span>
        <button class="btn small" data-slot="${p.slot}" data-worn="${p.worn ? 0 : 1}">${p.worn ? 'Take off' : 'Put on'}</button>
        <button class="btn small" data-forget="${p.slot}" title="Stop keeping this preview">Remove</button>
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
    const forget = event.target.closest('button[data-forget]')
    if (forget) cp.remove(Number(forget.dataset.forget))
  })
  keepEl.addEventListener('change', () => { cp.keepOnRoomChange = keepEl.checked })
  keepEl.checked = cp.keepOnRoomChange !== false

  let searchTimer = null
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(renderList, 120)
  })
  previewBtn.addEventListener('click', tryOn)
  removeAllBtn.addEventListener('click', takeAllOff)
  colorEl.addEventListener('input', () => { markSwatch(); renderLook() })

  // Previews stay on (and are kept) when this window closes; JR's shared
  // previews live on. Without them (older JR), closing takes them off.
  window.addEventListener('beforeunload', () => {
    stopWatching()
    if (!shared) { try { cp.takeAllOff() } catch (_) {} ; cp.dispose() }
    thumbs.dispose()
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
