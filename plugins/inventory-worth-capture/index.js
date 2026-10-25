'use strict'

/**
 * Inventory Reader, by BradysLabs: keeps a copy of your clothing and den
 * items from the game's own messages, for Inventory Worth and Trading.
 *
 *   il  [4]=0 your full clothing list: [7]=username, [10]=count, then per item
 *       from [11]: defId, invIdx, color, equipped avatars, shop it's in
 *   il  [4]=2 changes: [8]=color, [9]=added, [10]=removed, (invIdx, defId)*, invIdx*
 *   di  your den items: [5]=count, then per item from [7]: invIdx, defId, placed,
 *       version, approved, image, number, text, [10 more for mannequins], shop it's in
 *   dsb [5]=you: an item of yours sold from your shop: [9]=kind, [10]=invIdx
 *
 * Saved to inventory.json in this plugin's data folder; "items" is the
 * clothing list (the format Trading already reads) and "den" the den items.
 */

const fs = require('fs')
const path = require('path')

const MANNEQUIN = 4
const isFlag = (x) => x === 'true' || x === 'false'

/** Reads a den item list. Works out mannequins even before item names load. */
function parseDenItems (v, getDenItem = () => null) {
  const count = Math.max(0, Math.min(20000, Number(v[5]) || 0))
  const out = []
  let i = 7
  for (let n = 0; n < count && i + 8 < v.length; n++) {
    const invId = Number(v[i]); const defId = Number(v[i + 1])
    const placed = Number(v[i + 2]) || 0
    const version = Number(v[i + 3]) || 0
    const def = getDenItem(defId)
    let size = 9
    if (def) {
      if (def.specialType === MANNEQUIN) size = 19
    } else if (n < count - 1 && !isFlag(v[i + 9 + 4]) && isFlag(v[i + 19 + 4])) {
      size = 19
    }
    i += size
    if (invId >= 0 && defId > 0) out.push({ invId, defId, version, placed })
  }
  return out
}

function inventoryReader ({ dispatch, dataPath, application }) {
  const file = path.join(dataPath, 'inventory.json')
  const items = (application && application.items) || {}
  let clothing = new Map()
  let den = []
  let rawDen = null
  let receivedAt = null
  try {
    const old = JSON.parse(fs.readFileSync(file, 'utf8'))
    clothing = new Map((old.items || []).map(item => [String(item.invId), item]))
    den = Array.isArray(old.den) ? old.den : []
    receivedAt = old.receivedAt || null
  } catch (_) {}

  let timer = null
  const save = () => {
    receivedAt = new Date().toISOString()
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(dataPath, { recursive: true })
        fs.writeFileSync(file, JSON.stringify({ version: 2, receivedAt, items: [...clothing.values()], den }))
      } catch (_) {}
    }, 300)
  }

  const ownName = () => {
    const player = dispatch.getState('player') || {}
    return String(player.username || player.userName || player.screenName || player.name || '').toLowerCase()
  }
  const getDenItem = (id) => { try { return items.getDenItem ? items.getDenItem(id) : null } catch (_) { return null } }

  dispatch.onMessage({ type: 'aj', message: 'il', callback: ({ message }) => {
    const p = message.value
    if (!Array.isArray(p) || p.length < 11) return
    const kind = Number(p[4])
    if (kind === 0) {
      const username = String(p[7] || '').toLowerCase()
      if (!username || username !== ownName()) return
      const count = Math.max(0, Math.min(10000, Number(p[10]) || 0))
      const next = new Map()
      let i = 11
      for (let n = 0; n < count && i + 2 < p.length; n++, i += 5) {
        const [defId, invId, color] = p.slice(i, i + 3)
        if (!/^\d+$/.test(String(defId)) || !/^\d+$/.test(String(invId))) continue
        next.set(String(invId), { defId: Number(defId), invId: Number(invId), color: Number(color) >>> 0 })
      }
      clothing = next
      save()
    } else if (kind === 2) {
      const added = Math.max(0, Math.min(10000, Number(p[9]) || 0))
      const removed = Math.max(0, Math.min(10000, Number(p[10]) || 0))
      const color = Number(p[8]) >>> 0
      let i = 11
      for (let n = 0; n < added && i + 1 < p.length; n++, i += 2) {
        const invId = String(p[i]); const defId = Number(p[i + 1])
        if (/^\d+$/.test(invId) && Number.isFinite(defId)) clothing.set(invId, { defId, invId: Number(invId), color })
      }
      for (let n = 0; n < removed && i < p.length; n++, i++) clothing.delete(String(p[i]))
      save()
    }
  } })

  dispatch.onMessage({ type: 'aj', message: 'di', callback: ({ message }) => {
    if (!Array.isArray(message.value)) return
    rawDen = message.value
    den = parseDenItems(rawDen, getDenItem)
    save()
  } })

  // Your item sold from your My Shop: it's no longer yours.
  dispatch.onMessage({ type: 'aj', message: 'dsb', callback: ({ message }) => {
    const v = message.value
    if (!Array.isArray(v) || String(v[4]) !== '1' || String(v[5] || '').toLowerCase() !== ownName()) return
    const kind = Number(v[9]); const invId = Number(v[10])
    if (kind === 2) clothing.delete(String(invId))
    else if (kind === 0) den = den.filter(d => d.invId !== invId)
    else return
    save()
  } })

  // Inventory Worth reads this live.
  const api = {
    get () {
      // Read the den list again once item names have loaded.
      if (rawDen && items.ready) { den = parseDenItems(rawDen, getDenItem); rawDen = null }
      return { clothing: [...clothing.values()], den: den.slice(), receivedAt }
    }
  }
  dispatch.setState('jrInventory', api)
  return () => {
    clearTimeout(timer)
    if (dispatch.getState('jrInventory') === api) dispatch.setState('jrInventory', null)
  }
}

module.exports = inventoryReader
module.exports.parseDenItems = parseDenItems
