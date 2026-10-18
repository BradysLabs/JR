'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const { Presence, activityFor, encode } = require('../src/discord/presence')
const themes = require('../src/ui/themes')

test('rich presence: handshake, then the activity with the JR Discord button', async () => {
  const written = []
  let socket
  const p = new Presence({
    clientId: '123',
    connect: () => {
      socket = new EventEmitter()
      socket.write = (b) => written.push({ op: b.readInt32LE(0), body: JSON.parse(b.subarray(8).toString()) })
      socket.destroy = () => {}
      setImmediate(() => socket.emit('connect'))
      return socket
    }
  })
  p.set(activityFor([{ connected: true, room: 'Jamaa Township' }], { invite: 'https://discord.gg/x', startedAt: 1000 }))
  p.start()
  await new Promise(r => setImmediate(r))
  assert.deepEqual(written[0], { op: 0, body: { v: 1, client_id: '123' } })
  socket.emit('data', encode(1, { cmd: 'DISPATCH', evt: 'READY', data: { user: { username: 'x' } } }))
  const frame = written[1].body
  assert.equal(frame.cmd, 'SET_ACTIVITY')
  assert.equal(frame.args.activity.details, 'Playing Animal Jam Classic')
  assert.equal(frame.args.activity.state, 'In Jamaa Township')
  assert.deepEqual(frame.args.activity.buttons, [{ label: 'Join the JR Discord', url: 'https://discord.gg/x' }])
  p.setEnabled(false)
  assert.equal(written[2].body.args.activity, null)
  p.stop()
})

test('rich presence text for the launcher and for two accounts', () => {
  assert.equal(activityFor([], { invite: 'u', startedAt: 0 }).details, 'In the JR launcher')
  const two = activityFor([{ connected: true }, { connected: true }], { invite: 'u', startedAt: 0 })
  assert.equal(two.state, '2 accounts online')
})

test('themes: every theme has the full set of colors; Midnight matches the original', () => {
  for (const t of themes.THEMES) {
    const v = themes.variables(t.id)
    for (const k of ['--bg', '--panel', '--line', '--text', '--dim', '--faint', '--accent', '--accent-ink']) assert.ok(v[k], `${t.id} ${k}`)
  }
  assert.equal(themes.variables('midnight')['--accent'], '#f4f4f5')
  assert.equal(themes.themeById('nope').id, 'midnight')
})

test('anti-kick game file patch is available', () => {
  const swf = require('../src/game/swf')
  assert.equal(typeof swf.patchIdleKick, 'function')
})
