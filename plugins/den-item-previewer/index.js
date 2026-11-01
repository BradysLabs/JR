/*
 * Den Item Previewer, by BradysLabs: place any den item in your own den, on
 * your screen only. See den.js for how it works.
 */
(async function () {
  const MAX_ROWS = 300
  const $ = id => document.getElementById(id)
  const path = require('path')
  const root = path.resolve(__dirname, '..', '..')
  const { DenPreviews } = require(path.join(__dirname, 'den.js'))
  const { joinPacket } = require(path.join(root, 'plugins', 'recent-rooms', 'rooms.js'))
  const { createThumbs } = require(path.join(root, 'src', 'ui', 'thumbs.js'))
  const { itemMatcher } = require(path.join(root, 'src', 'game', 'search.js'))

  const jam = await new Promise(resolve => {
    if (window.jam && window.jam.dispatch) return resolve(window.jam)
    const timer = setInterval(() => {
      if (window.jam && window.jam.dispatch) { clearInterval(timer); resolve(window.jam) }
    }, 50)
  })
  const { dispatch, application } = jam
  const db = application && application.items
  const pictures = application && application.pictures

  let items = []          // [{ id, name, members }]
  let selected = null
  let version = 0

  const listEl = $('list')
  const escapeHtml = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const thumb = (id, v = 0, cls = '') => `<span class="thumbBox ${cls}"><img class="thumb" alt="" data-kind="den" data-id="${id}" data-version="${v}"></span>`

  function setStatus (text, kind = '') {
    $('status').textContent = text
    $('status').className = kind
    $('dot').className = 'dot' + (kind === 'ok' ? ' live' : kind === 'warn' ? ' warn' : '')
  }

  function myName () {
    try {
      const p = dispatch.getState('player')
      const name = p && (p.username || p.userName || p.screenName || p.name)
      return typeof name === 'string' && name ? name.toLowerCase() : null
    } catch (_) { return null }
  }

  // JR keeps one set of previews, shared with this plugin's window in the game.
  const shared = application && application.denPreviews
  const den = shared || new DenPreviews({
    dispatch,
    getDenItem: id => (db && db.getDenItem(id)) || null,
    myName,
    joinPacket
  })
  const stopWatching = den.watch(() => renderActive())
  const thumbs = createThumbs({ pictures, scroller: listEl, onPicture: key => { if (selected && key.startsWith(`d${selected.id}_`)) renderVersions() } })
  const activeThumbs = createThumbs({ pictures, scroller: $('active') })

  // Worth, from the Item Worth Wiki (same as Inventory Worth).
  let pricer = null
  function getPricer () {
    if (pricer || !db || !db.ready) return pricer
    try { pricer = require(path.join(root, 'src', 'worth', 'pricer.js')).createPricer({ root, items: db }) } catch (_) {}
    return pricer
  }

  // ------------------------------------------------------------ list

  function renderList () {
    const q = $('search').value.trim().toLowerCase()
    const match = itemMatcher(q)
    const matches = q ? items.filter(i => match(i.name, i.id)) : items
    const shown = matches.slice(0, MAX_ROWS)
    $('count').textContent = matches.length > MAX_ROWS
      ? `Showing ${MAX_ROWS} of ${matches.length.toLocaleString()} - search to narrow it down`
      : `${matches.length.toLocaleString()} den item${matches.length === 1 ? '' : 's'}`
    if (!shown.length) {
      listEl.innerHTML = `<div class="empty">${items.length ? 'No items match.' : 'No item names loaded.'}</div>`
      return
    }
    listEl.innerHTML = shown.map(i => `
      <div class="row${selected && selected.id === i.id ? ' selected' : ''}" data-id="${i.id}" role="option">
        ${thumb(i.id)}
        <span class="name">${escapeHtml(i.name)}</span>
        ${i.members ? '<span class="tag">Member</span>' : ''}
        <span class="id">#${i.id}</span>
      </div>`).join('')
    listEl.scrollTop = 0
    thumbs.watch()
  }

  // ------------------------------------------------------------ selected

  function renderSelected () {
    $('selName').textContent = selected ? selected.name : 'Pick an item'
    $('selMeta').textContent = selected ? `Den item #${selected.id}${selected.members ? ' · members' : ''}` : ''
    $('place').disabled = !selected
    $('denNote').textContent = den.ownDen()
      ? 'It appears where you last walked in your den, on your screen only. Nobody else sees it and the server never hears about it.'
      : 'Go into your own den, then place it. It appears where you last walked, on your screen only. Nobody else sees it and the server never hears about it.'
    renderPicture()
    renderWorth()
    renderVersions()
  }

  function renderPicture () {
    const pic = $('pic')
    pic.innerHTML = ''
    if (!selected) return
    pic.innerHTML = `<img class="thumb" alt="" data-kind="den" data-id="${selected.id}" data-version="${version}">`
    const img = pic.querySelector('img')
    img.onerror = () => { img.remove(); pic.textContent = 'No picture' }
    thumbs.show(img)
    if (!pictures) pic.textContent = 'Pictures show once you’re in the game.'
  }

  function renderWorth () {
    $('worth').textContent = ''
    $('worthNote').textContent = ''
    if (!selected) return
    const p = getPricer()
    if (!p) return
    let v = null
    try { v = p.value({ kind: 'den', id: selected.id }) } catch (_) {}
    if (!v) return
    if (v.diamonds) $('worth').textContent = p.format(v.diamonds)
    else if (v.status === 'store') $('worth').textContent = v.store ? `In stores · ${v.store.cost.toLocaleString()} ${v.store.currency}` : 'In stores'
    else if (v.store) $('worth').textContent = `Store price · ${v.store.cost.toLocaleString()} ${v.store.currency}`
    else if (v.text) $('worth').textContent = v.text.slice(0, 80)
    else $('worth').textContent = 'No worth listed'
    $('worthNote').textContent = v.diamonds || v.text ? `Item Worth Wiki${v.text ? ` · ${v.text.slice(0, 120)}` : ''}` : v.store ? 'Not on the Item Worth Wiki' : ''
  }

  // Versions: as many as the game says this item has (known once it has
  // drawn its picture), otherwise a number box.
  function renderVersions () {
    const box = $('versionBox')
    const count = selected && pictures ? pictures.versionCount(selected.id) : null
    box.classList.toggle('hidden', !selected || count === 0 || count === 1)
    $('versionField').classList.toggle('hidden', count != null)
    const el = $('versions')
    el.innerHTML = ''
    if (!selected || !count || count < 2) return
    for (let n = 0; n < count; n++) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'ver' + (n === version ? ' active' : '')
      b.textContent = n + 1
      b.addEventListener('click', () => { version = n; renderVersions(); renderPicture() })
      el.appendChild(b)
    }
  }

  // ------------------------------------------------------------ previews

  function renderActive () {
    const list = den.list()
    $('clear').disabled = !list.length
    if (!list.length) { $('active').innerHTML = '<div class="empty">Nothing yet.</div>'; return }
    $('active').innerHTML = list.map(p => `
      <div class="active-row">
        ${thumb(p.defId, p.version)}
        <span class="name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}${p.version ? ` · v${p.version + 1}` : ''}</span>
        <span class="hint">${p.placed ? 'in your den' : 'in your den items'}</span>
        <button class="btn small" data-remove="${p.slot}">Remove</button>
      </div>`).join('')
    activeThumbs.watch()
  }

  const SHOWN = {
    den: (name) => [`${name} is in your den and your den items. Drag it wherever you like.`, 'ok'],
    bar: (name) => [`${name} is in your den items. Go into your den to place it.`, 'ok'],
    later: (name) => [`${name} will be in your den next time you go in.`, 'warn']
  }

  async function place () {
    if (!selected) return
    const v = $('versionField').classList.contains('hidden') ? version : Math.max(0, Number($('version').value) || 0)
    try {
      const { preview, shown } = await den.place(selected.id, { version: v })
      setStatus(...SHOWN[shown](preview.name))
    } catch (error) { setStatus(error.message, 'error') }
  }

  // ------------------------------------------------------------ events

  listEl.addEventListener('click', e => {
    const row = e.target.closest('.row')
    if (!row) return
    selected = items.find(i => i.id === Number(row.dataset.id)) || null
    version = 0
    listEl.querySelectorAll('.row.selected').forEach(r => r.classList.remove('selected'))
    row.classList.add('selected')
    renderSelected()
  })
  listEl.addEventListener('dblclick', e => { if (e.target.closest('.row') && selected) place() })
  $('active').addEventListener('click', e => {
    const remove = e.target.closest('[data-remove]')
    if (remove) den.remove(Number(remove.dataset.remove)).then(() => setStatus('Removed from your den', 'ok')).catch(error => setStatus(error.message, 'error'))
  })
  $('place').addEventListener('click', place)
  $('clear').addEventListener('click', () => { den.clear().then(had => { if (had) setStatus('Removed all previews', 'ok') }) })
  let searchTimer = null
  $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderList, 120) })
  const onState = key => { if (key === 'roomName') renderSelected() }
  if (typeof dispatch.on === 'function') dispatch.on('state', onState)

  window.addEventListener('beforeunload', () => {
    stopWatching()
    // Previews made here stay while JR's in-game window can still show them.
    if (!shared) { try { den.clear() } catch (_) {} ; den.dispose() }
    thumbs.dispose()
    activeThumbs.dispose()
    if (typeof dispatch.off === 'function') dispatch.off('state', onState)
  })

  // ------------------------------------------------------------ start

  try {
    if (!db) throw new Error('Item names are not available in this version of JR.')
    if (!db.ready && typeof db.load === 'function') await db.load()
    items = [...db.den.entries()]
      .map(([id, it]) => ({ id: Number(id), name: (it && it.name) || `Den item #${id}`, members: Boolean(it && it.members), special: it && it.specialType }))
      .filter(i => Number.isFinite(i.id) && !/^\d+$/.test(i.name))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    $('count').textContent = `Couldn't load item names: ${error.message}`
  }
  setStatus(myName() ? 'Ready' : 'Log in to Animal Jam', myName() ? 'ok' : 'warn')
  renderList()
  renderSelected()
  renderActive()
})()
