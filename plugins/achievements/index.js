/**
 * Achievements window script. Runs inside the plugin window that Jam opens
 * from the sidebar; Jam hands it `window.jam` (application + dispatch).
 */
(function () {
  function waitForJam () {
    return new Promise(resolve => {
      if (window.jam && window.jam.dispatch) return resolve(window.jam)
      const t = setInterval(() => {
        if (window.jam && window.jam.dispatch) { clearInterval(t); resolve(window.jam) }
      }, 50)
    })
  }

  const ready = waitForJam()


  /**
   * Achievement names and descriptions, read from the game's own data
   * (defPack 1042 = achievements, 10230 = text strings).
   */
  const ACHIEVEMENT_PACK = '1042'
  const STRINGS_PACK = '10230'
  let infoPromise = null

  function str (strings, key) {
    if (!strings || key === undefined || key === null || key === '') return null
    const value = strings[key]
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }

  // Picks the first string field whose name matches, e.g. titleStrId / descStrId.
  function pickString (entry, strings, pattern) {
    for (const [field, value] of Object.entries(entry)) {
      if (pattern.test(field) && /str(id|ref)?$/i.test(field)) {
        const text = str(strings, value)
        if (text) return text
      }
    }
    return null
  }

  // "1_Gems_1000_Gems_Earned" -> "Gems 1000 Gems Earned"
  function prettyName (name) {
    if (!name) return null
    return String(name).replace(/^\d+_/, '').replace(/_/g, ' ').trim() || null
  }

  async function loadInfo () {
    const jam = await ready
    const items = jam.application && jam.application.items
    if (!items || typeof items.fetchPack !== 'function') throw new Error('Game data is not available.')
    if (!items.deployVersion && typeof items.load === 'function') await items.load().catch(() => {})
    if (!items.deployVersion) throw new Error('Game version unknown - is the game open?')

    const [pack, strings] = await Promise.all([
      items.fetchPack(items.deployVersion, ACHIEVEMENT_PACK),
      items.fetchPack(items.deployVersion, STRINGS_PACK)
    ])

    const info = new Map()
    for (const [key, entry] of Object.entries(pack || {})) {
      if (!entry || typeof entry !== 'object') continue
      const id = Number(entry.id !== undefined ? entry.id : entry.defId !== undefined ? entry.defId : key)
      if (!Number.isFinite(id)) continue
      const extra = entry.extraText ? String(entry.extraText) : ''
      const fill = text => text && extra ? text.replace(/\{0\}|%s/g, extra) : text
      info.set(id, {
        name: fill(pickString(entry, strings, /title/i)) || prettyName(entry.name),
        description: fill(pickString(entry, strings, /desc/i)),
        amount: entry.triggerAmount ? Number(entry.triggerAmount) : null,
        raw: entry
      })
    }
    return info
  }

  window.Achievements = {
    getInfo () {
      if (!infoPromise) infoPromise = loadInfo().catch(err => { infoPromise = null; throw err })
      return infoPromise
    },

    async getRoomState () {
      const jam = await ready
      const room = jam.dispatch.getState('room')
      return { connected: !!jam.dispatch.connected, room: room || null }
    },

    async send (achievementId) {
      try {
        const jam = await ready
        const room = jam.dispatch.getState('room')
        if (!jam.dispatch.connected) throw new Error('Client is disconnected.')
        if (!room) throw new Error('You must be in a room to send achievement packets.')
        await jam.dispatch.sendRemoteMessage(`%xt%o%zs%${room}%${achievementId}%9999999%1%`)
        return { success: true }
      } catch (err) {
        return { success: false, error: err.message }
      }
    }
  }
})()
