'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { decode } = require('../src/engine/codec')
const { describeRoom, joinPacket } = require('../plugins/recent-rooms/rooms')
const VISIT = require('./fixtures/den-visit.json')

test('recent rooms: names and the packets that go back', () => {
  assert.deepEqual(describeRoom('jamaa_township.room_main#9'), { title: 'Jamaa Township', detail: 'copy 9' })
  assert.deepEqual(describeRoom('sarepia_forest.room_theater'), { title: 'Sarepia Forest · Theater', detail: '' })
  assert.equal(describeRoom('denfriend').title, 'friend’s den')
  assert.match(describeRoom('quest_staging.room_1').detail, /may not let you back in/)
  assert.equal(joinPacket('100', 'denFriend'), '%xt%o%dj%100%denfriend%1%-1%')
  assert.equal(joinPacket('100', 'jamaa_township.room_main#9'), '%xt%o%rj%100%jamaa_township.room_main#9%1%0%0%')
  assert.equal(joinPacket('100', 'sarepia_forest.room_main'), '%xt%o%rj%100%sarepia_forest.room_main#1%1%0%0%')
  assert.throws(() => joinPacket(null, 'denfriend'), /Join a room/)
})

test('recent rooms: JR remembers rooms since login, newest first, no repeats', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-rooms-'))
  const info = { root: path.join(__dirname, '..'), dataDir: path.join(tmp, 'd'), cacheDir: path.join(tmp, 'c'), userPlugins: path.join(tmp, 'p'), profile: { name: 'T', id: 't' }, version: '0.1.0' }
  fs.mkdirSync(info.dataDir, { recursive: true })
  const engine = require('../src/ui/engine.js')(info)
  const d = engine.dispatch
  const join = (name, id) => d.process(decode(`%xt%rj%1%1%${name}%${id}%1%`, 'in'))
  await join('jamaa_township.room_main#9', '500')
  await d.process(decode(VISIT.rj, 'in')) // a real den join
  await join('jamaa_township.room_main#9', '501')
  const rooms = engine.application.recentRooms()
  assert.deepEqual(rooms.map(r => [r.name, r.id, r.den]), [['jamaa_township.room_main#9', '501', false], ['denfriend', '1072141', true]])
  // Logging in again starts a new list.
  d.setState('player', { userName: 'Someone' })
  assert.deepEqual(engine.application.recentRooms(), [])
  engine.host.unloadAll()
})
