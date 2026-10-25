'use strict'

/**
 * Recent Rooms, by BradysLabs: names and join packets for rooms you've been in.
 *   Dens:  %xt%o%dj%<room>%den<owner>%1%-1%
 *   Rooms: %xt%o%rj%<room>%<room name>#<server copy>%1%0%0%
 */

const titleCase = (s) => String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

/** "jamaa_township.room_main#9" -> { title: 'Jamaa Township', detail: 'copy 9' } */
function describeRoom (name) {
  const n = String(name || '')
  if (/^den./i.test(n)) return { title: `${n.slice(3)}’s den`, detail: 'Den' }
  const [path, copy] = n.split('#')
  const bits = path.split('.')
  const area = titleCase(bits[0] || path)
  const part = bits[1] && !/^room_main$/i.test(bits[1]) ? titleCase(bits[1].replace(/^room_/i, '')) : ''
  const odd = /quest|adventure|party|minigame|staging/i.test(path)
  return { title: part ? `${area} · ${part}` : area, detail: [copy ? `copy ${copy}` : '', odd ? 'may not let you back in' : ''].filter(Boolean).join(' · ') }
}

/** The packet that takes you back to a room. */
function joinPacket (fromRoom, name) {
  if (!fromRoom) throw new Error('Join a room in Animal Jam first.')
  const n = String(name || '')
  if (!n) throw new Error('No room picked.')
  if (/^den./i.test(n)) return `%xt%o%dj%${fromRoom}%${n.toLowerCase()}%1%-1%`
  return `%xt%o%rj%${fromRoom}%${n.includes('#') ? n : n + '#1'}%1%0%0%`
}

module.exports = { describeRoom, joinPacket }
