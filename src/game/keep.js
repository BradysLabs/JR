'use strict'

/**
 * Previews you keep: what you previewed (clothing you tried on, den items you
 * placed) saved in your JR profile per Animal Jam account, so they're back
 * the next time you log in. Only on this computer, never sent anywhere.
 *
 *   const keep = keepStore(path.join(profileDir, 'plugin-data', 'den-item-previewer', 'kept.json'))
 *   keep.load('username') -> []    keep.save('username', [...])
 */

const fs = require('fs')
const path = require('path')

function keepStore (file) {
  const read = () => { try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return d && typeof d === 'object' && !Array.isArray(d) ? d : {} } catch (_) { return {} } }
  return {
    load (user) {
      if (!user) return []
      const list = read()[String(user).toLowerCase()]
      return Array.isArray(list) ? list : []
    },
    save (user, list) {
      if (!user) return
      const all = read()
      if (list && list.length) all[String(user).toLowerCase()] = list
      else delete all[String(user).toLowerCase()]
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(all, null, 1))
      } catch (_) {}
    }
  }
}

/** A store that keeps nothing (tests, or no profile). */
const noKeep = { load: () => [], save: () => {} }

module.exports = { keepStore, noKeep }
