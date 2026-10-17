(() => {
  'use strict'

  const pets = Array.isArray(window.PET_CATALOG)
    ? window.PET_CATALOG.slice().sort((a, b) => a.id - b.id)
    : []

  const FAVORITES_KEY = 'petCatalogFavorites'
  const RECENTS_KEY = 'petCatalogRecent'
  const MAX_RECENTS = 12
  const state = {
    selectedId: null,
    query: '',
    filter: 'all',
    filtered: pets,
    purchaseTemplate: null,
    purchaseBusy: false,
    stopListening: null,
    pendingPurchases: []
  }

  const $ = id => document.getElementById(id)

  function readIds (key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '[]')
      return Array.isArray(parsed)
        ? parsed.map(Number).filter(id => pets.some(pet => pet.id === id))
        : []
    } catch {
      return []
    }
  }

  function writeIds (key, ids) {
    try {
      localStorage.setItem(key, JSON.stringify(ids))
    } catch {
      // The catalog still works when storage is unavailable.
    }
  }

  function selectedPet () {
    return pets.find(pet => pet.id === state.selectedId) || null
  }

  function addRecent (id) {
    const recent = readIds(RECENTS_KEY).filter(itemId => itemId !== id)
    recent.unshift(id)
    writeIds(RECENTS_KEY, recent.slice(0, MAX_RECENTS))
  }

  function selectPet (id) {
    const pet = pets.find(item => item.id === Number(id))
    if (!pet) return

    state.selectedId = pet.id
    addRecent(pet.id)
    renderSelected()
    renderPurchase()
    renderResults()
    renderRecent()
  }

  function setPurchaseStatus (message, type = '') {
    const status = $('purchase-status')
    status.textContent = message
    status.className = `purchase-status ${type}`.trim()
  }

  function renderPurchase () {
    const pet = selectedPet()
    $('buy-pet').disabled = !pet || !state.purchaseTemplate || state.purchaseBusy
    $('buy-pet').textContent = pet ? `Buy Pet #${pet.id}` : 'Buy Selected Pet'
    $('purchase-id').textContent = pet ? `Selected pet ID: ${pet.id} · ${pet.name}` : 'Select a pet to begin.'
    $('purchase-packet').disabled = !state.purchaseTemplate || state.purchaseBusy
    $('purchase-packet').value = pet && state.purchaseTemplate
      ? makePurchasePacket(state.purchaseTemplate, pet.id)
      : ''
  }

  function parsePetPacket (packet) {
    if (!packet || packet.direction !== 'out' || packet.fromPlugin || typeof packet.raw !== 'string') return null

    const parts = packet.raw.trim().split('%')
    if (parts[0] !== '' || parts[1] !== 'xt' || parts[2] !== 'o' || parts[3] !== 'pc' || parts.length < 12) return null

    const shopId = Number(parts[5])
    const lBits = Number(parts[6])
    if (!Number.isSafeInteger(shopId) || !Number.isSafeInteger(lBits)) return null

    const petId = (lBits >>> 0) & 0xff
    if (!pets.some(pet => pet.id === petId)) return null

    return { parts, shopId, lBits, petId }
  }

  function capturePurchase (packet) {
    if (packet && packet.direction === 'in' && packet.type === 'login') {
      state.purchaseTemplate = null
      state.pendingPurchases = []
      setPurchaseStatus('Login changed. Make a normal pet purchase in the game to capture a fresh request.', 'warning')
      renderPurchase()
      return
    }

    if (packet && packet.direction === 'in' && packet.type === 'pc' && typeof packet.raw === 'string') {
      const parts = packet.raw.trim().split('%')
      if (parts[0] !== '' || parts[1] !== 'xt' || parts[2] !== 'pc') return

      const request = state.pendingPurchases.shift()
      const success = parts[4] === '1'
      if (!success) {
        setPurchaseStatus('The game server refused the last pet request. Check the in-game message and your balance.', 'error')
        return
      }

      const lBits = Number(parts[8])
      const petId = Number.isSafeInteger(lBits) ? (lBits >>> 0) & 0xff : null
      const pet = pets.find(item => item.id === petId)
      if (request && request.petId !== petId) {
        setPurchaseStatus('The server reply did not match the captured pet ID; please make a normal purchase again before using Buy.', 'warning')
        return
      }

      setPurchaseStatus(pet
        ? `The server accepted the normal purchase for ${pet.name} (#${pet.id}).`
        : 'The server accepted the normal pet purchase.', 'success')
      return
    }

    const candidate = parsePetPacket(packet)
    if (!candidate) return

    state.pendingPurchases.push({ petId: candidate.petId })
    state.purchaseTemplate = {
      parts: candidate.parts,
      lBitsIndex: 6,
      sourcePetId: candidate.petId,
      shopId: candidate.shopId
    }
    const sourcePet = pets.find(item => item.id === candidate.petId)
    setPurchaseStatus(sourcePet
      ? `Captured the normal Pet Creator request for ${sourcePet.name} (#${sourcePet.id}). The catalog ID is in the low byte of lBits.`
      : 'Captured a normal Pet Creator request.', 'success')
    renderPurchase()
  }

  function replacePetIdInLBits (lBits, petId) {
    const unsigned = Number(lBits) >>> 0
    const replaced = ((unsigned & 0xffffff00) | (Number(petId) & 0xff)) >>> 0
    return String(replaced > 0x7fffffff ? replaced - 0x100000000 : replaced)
  }

  function makePurchasePacket (template, petId) {
    const parts = [...template.parts]
    parts[template.lBitsIndex] = replacePetIdInLBits(parts[template.lBitsIndex], petId)
    return parts.join('%')
  }

  function isEditedPacketValid (raw, template, petId) {
    const parts = raw.trim().split('%')
    const expected = makePurchasePacket(template, petId).split('%')
    return parts.length === expected.length &&
      parts.every((part, index) => part === expected[index])
  }

  async function buySelectedPet () {
    const pet = selectedPet()
    const template = state.purchaseTemplate
    if (!pet || !template || state.purchaseBusy) return


    const raw = $('purchase-packet').value.trim()
    if (!isEditedPacketValid(raw, template, pet.id)) {
      setPurchaseStatus('Packet edit rejected. Only the selected pet definition ID can change; restore the generated packet before sending.', 'error')
      return
    }

    state.purchaseBusy = true
    renderPurchase()
    state.pendingPurchases.push({ petId: pet.id })
    setPurchaseStatus(`Sending the displayed Pet Creator request for ${pet.name} (#${pet.id})…`, 'waiting')

    try {
      const result = await window.jam.dispatch.sendRemoteMessage(raw)
      if (!Array.isArray(result) || result.length === 0) throw new Error('No active game connection was available.')
      setPurchaseStatus(`Request sent for ${pet.name} (#${pet.id}). Waiting for the server's result…`, 'waiting')
    } catch (error) {
      state.pendingPurchases.pop()
      setPurchaseStatus(`Could not send the request: ${error.message || error}`, 'error')
    } finally {
      state.purchaseBusy = false
      renderPurchase()
    }
  }

  function matchesFilter (pet) {
    switch (state.filter) {
      case 'member': return pet.isMember
      case 'open': return !pet.isMember
      case 'reward': return pet.isReward
      case 'egg': return pet.isEgg
      case 'favorites': return readIds(FAVORITES_KEY).includes(pet.id)
      default: return true
    }
  }

  function applyFilters () {
    const query = state.query.trim().toLocaleLowerCase()
    state.filtered = pets.filter(pet => {
      const textMatch = !query ||
        pet.name.toLocaleLowerCase().includes(query) ||
        String(pet.id).includes(query)
      return textMatch && matchesFilter(pet)
    })
    renderResults()
  }

  function makeBadge (label, className = '') {
    const badge = document.createElement('span')
    badge.className = `badge ${className}`.trim()
    badge.textContent = label
    return badge
  }

  function renderResults () {
    const results = $('results')
    results.replaceChildren()
    $('result-count').textContent = `${state.filtered.length} of ${pets.length} pets`

    if (!state.filtered.length) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = 'No pets match these filters.'
      results.appendChild(empty)
      return
    }

    const favorites = readIds(FAVORITES_KEY)
    state.filtered.forEach(pet => {
      const row = document.createElement('div')
      row.className = `pet-row${state.selectedId === pet.id ? ' selected' : ''}`
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', String(state.selectedId === pet.id))
      row.tabIndex = 0

      const main = document.createElement('div')
      main.className = 'pet-main'
      const name = document.createElement('div')
      name.className = 'pet-name'
      name.textContent = pet.name
      const meta = document.createElement('div')
      meta.className = 'pet-meta'
      meta.textContent = `ID ${pet.id} · ${pet.isMember ? 'Member flag' : 'Non-member flag'}${pet.isReward ? ' · Reward' : ''}${pet.isEgg ? ' · Egg' : ''}`
      main.append(name, meta)

      const favorite = document.createElement('button')
      favorite.type = 'button'
      favorite.className = `small-button favorite${favorites.includes(pet.id) ? ' active' : ''}`
      favorite.textContent = favorites.includes(pet.id) ? '★ Saved' : '☆ Save'
      favorite.setAttribute('aria-label', `${favorites.includes(pet.id) ? 'Remove' : 'Add'} ${pet.name} ${favorites.includes(pet.id) ? 'from' : 'to'} favorites`)
      favorite.addEventListener('click', event => {
        event.stopPropagation()
        const next = readIds(FAVORITES_KEY)
        writeIds(FAVORITES_KEY, next.includes(pet.id)
          ? next.filter(id => id !== pet.id)
          : [...next, pet.id])
        applyFilters()
      })

      row.append(main, favorite)
      row.addEventListener('click', () => selectPet(pet.id))
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          selectPet(pet.id)
        }
      })
      results.appendChild(row)
    })
  }

  function renderSelected () {
    const pet = selectedPet()
    const badgeBox = $('badges')
    badgeBox.replaceChildren()

    if (!pet) {
      $('selected-name').textContent = 'Select a pet'
      ;['id', 'cost', 'member', 'type', 'status', 'title-ref', 'media-ref', 'reward'].forEach(id => {
        $(`selected-${id}`).textContent = '—'
      })
      return
    }

    $('selected-name').textContent = pet.name
    $('selected-id').textContent = pet.id
    $('selected-cost').textContent = Number(pet.cost).toLocaleString()
    $('selected-member').textContent = pet.isMember ? 'Yes' : 'No'
    $('selected-type').textContent = pet.type
    $('selected-status').textContent = pet.status
    $('selected-title-ref').textContent = pet.titleStrId
    $('selected-media-ref').textContent = pet.mediaRefId
    $('selected-reward').textContent = `${pet.isReward ? 'Yes' : 'No'} / ${pet.isEgg ? 'Yes' : 'No'}`

    badgeBox.appendChild(makeBadge(`Pet #${pet.id}`))
    badgeBox.appendChild(makeBadge(pet.isMember ? 'Member flag' : 'Non-member flag', pet.isMember ? 'member' : 'open'))
    if (pet.isReward) badgeBox.appendChild(makeBadge('Reward definition'))
    if (pet.isEgg) badgeBox.appendChild(makeBadge('Egg definition'))
  }

  function renderRecent () {
    const recentList = $('recent-list')
    recentList.replaceChildren()
    const recentPets = readIds(RECENTS_KEY)
      .map(id => pets.find(pet => pet.id === id))
      .filter(Boolean)

    if (!recentPets.length) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = 'No recently viewed pets.'
      recentList.appendChild(empty)
      return
    }

    recentPets.forEach(pet => {
      const row = document.createElement('div')
      row.className = 'recent-row'
      const label = document.createElement('div')
      label.className = 'recent-label'
      const name = document.createElement('span')
      name.className = 'recent-name'
      name.textContent = pet.name
      const id = document.createElement('span')
      id.className = 'recent-id'
      id.textContent = `#${pet.id}`
      label.append(name, id)

      const view = document.createElement('button')
      view.className = 'small-button'
      view.type = 'button'
      view.textContent = 'View'
      view.addEventListener('click', () => selectPet(pet.id))
      row.append(label, view)
      recentList.appendChild(row)
    })
  }

  function initialize () {
    if (!pets.length) {
      $('result-count').textContent = 'Pet data could not be loaded.'
      return
    }

    const recentIds = readIds(RECENTS_KEY)
    state.selectedId = recentIds.length ? recentIds[0] : pets[0].id

    $('search').addEventListener('input', event => {
      state.query = event.target.value
      applyFilters()
    })
    $('search').addEventListener('keydown', event => {
      if (event.key === 'Enter' && state.filtered.length) {
        selectPet(state.filtered[0].id)
      }
    })
    $('clear-search').addEventListener('click', () => {
      $('search').value = ''
      state.query = ''
      applyFilters()
      $('search').focus()
    })
    document.querySelectorAll('.filter-button').forEach(button => {
      button.addEventListener('click', () => {
        state.filter = button.dataset.filter
        document.querySelectorAll('.filter-button').forEach(item => {
          item.classList.toggle('active', item === button)
        })
        applyFilters()
      })
    })

    $('buy-pet').addEventListener('click', buySelectedPet)
    if (window.jam && typeof window.jam.onPacket === 'function') {
      state.stopListening = window.jam.onPacket(capturePurchase)
    } else {
      setPurchaseStatus('This JR version does not expose packet capture. Update JR to use purchase requests.', 'error')
    }
    window.addEventListener('beforeunload', () => {
      if (typeof state.stopListening === 'function') state.stopListening()
    })

    renderSelected()
    renderPurchase()
    renderRecent()
    applyFilters()
  }

  document.addEventListener('DOMContentLoaded', initialize)
})()
