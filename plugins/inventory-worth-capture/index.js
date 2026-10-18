'use strict'

const fs = require('fs')
const path = require('path')

module.exports = function inventoryReader ({ dispatch, dataPath, application }) {
  const file = path.join(dataPath, 'inventory.json')
  const save = (inventory, receivedAt = new Date().toISOString()) => {
    fs.mkdirSync(dataPath, { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ version: 1, kind: 'clothing', receivedAt, items: [...inventory.values()] }))
  }
  let inventory = new Map()
  try {
    const old = JSON.parse(fs.readFileSync(file, 'utf8'))
    inventory = new Map((old.items || []).map(item => [String(item.invId), item]))
  } catch (_) {}

  const ownName = () => {
    const player = dispatch.getState('player') || {}
    return String(player.username || player.userName || player.screenName || player.name || '').toLowerCase()
  }
  dispatch.onMessage({ type: 'aj', message: 'il', callback: ({ message }) => {
    const p = message.value
    if (!Array.isArray(p) || p.length < 11) return
    const kind = Number(p[4])
    const username = String(p[7] || '').toLowerCase()
    if (!username || username !== ownName()) return

    // Full own inventory: each clothing row is defId, invId, color, equipped avatars, den-store id.
    if (kind === 0) {
      const count = Math.max(0, Math.min(10000, Number(p[10]) || 0))
      const next = new Map()
      let i = 11
      for (let n = 0; n < count && i + 2 < p.length; n++, i += 5) {
        const [defId, invId, color] = p.slice(i, i + 3)
        if (!/^\d+$/.test(String(defId)) || !/^\d+$/.test(String(invId))) continue
        next.set(String(invId), { defId: Number(defId), invId: Number(invId), color: Number(color) >>> 0 })
      }
      inventory = next
      save(inventory)
      return
    }

    // Incremental add/remove update. Added pairs are invId, defId; removed entries are invIds.
    if (kind === 2) {
      const added = Math.max(0, Math.min(10000, Number(p[9]) || 0))
      const removed = Math.max(0, Math.min(10000, Number(p[10]) || 0))
      const color = Number(p[8]) >>> 0
      let i = 11
      for (let n = 0; n < added && i + 1 < p.length; n++, i += 2) {
        const invId = String(p[i]), defId = Number(p[i + 1])
        if (/^\d+$/.test(invId) && Number.isFinite(defId)) inventory.set(invId, { defId, invId: Number(invId), color })
      }
      for (let n = 0; n < removed && i < p.length; n++, i++) inventory.delete(String(p[i]))
      save(inventory)
    }
  } })
}
