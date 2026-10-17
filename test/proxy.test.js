'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Dispatch } = require('../src/engine/dispatch')
const { Proxy, POLICY } = require('../src/engine/proxy')
const { FakeServer, FakeGame, sleep } = require('./helpers/fake-aj')

async function setup ({ secure = true, packetsPerSecond = 50 } = {}) {
  const server = await new FakeServer({ secure }).start()
  const logs = []
  const dispatch = new Dispatch({ packetsPerSecond, log: e => logs.push(e) })
  const proxy = new Proxy({ dispatch, upstream: () => server.target })
  await proxy.listen()
  const game = await new FakeGame(proxy.port).connect()
  const done = async () => {
    game.close()
    await proxy.close()
    await server.stop()
  }
  return { server, dispatch, proxy, game, logs, done }
}

const LOGIN = "<msg t='sys'><body action='login' r='0'><login z='sbiLogin'><nick><![CDATA[TestJammer]]></nick><pword><![CDATA[token]]></pword></login></body></msg>"

test('passes traffic both ways over TLS and tracks login + room', async () => {
  const { server, dispatch, game, done } = await setup()
  try {
    game.send("<msg t='sys'><body action='verChk' r='0'><ver v='165' /></body></msg>")
    await game.waitFor('apiOK')
    assert.equal(dispatch.connected, true)

    game.send(LOGIN)
    await game.waitFor('"_cmd":"login"')
    assert.equal(dispatch.getState('player').userName, 'TestJammer')

    game.send('%xt%o%rj%-1%denTestJammer%')
    await game.waitFor('%xt%rj%')
    assert.equal(dispatch.getState('room'), '844480')
    assert.equal(dispatch.getState('roomName'), 'denTestJammer')
    assert.ok(server.received.includes(LOGIN))
  } finally { await done() }
})

test('plain TCP upstream works too', async () => {
  const { game, done } = await setup({ secure: false })
  try {
    game.send('%xt%o%rj%-1%jamaa_township.room_main#11%')
    await game.waitFor('jamaa_township')
  } finally { await done() }
})

test('hooks can change and block packets in each direction', async () => {
  const { server, dispatch, game, done } = await setup()
  try {
    dispatch.onMessage({
      type: 'aj',
      message: 'login',
      callback: ({ message }) => { message.value.b.o.params.accountType = 2 }
    })
    dispatch.onMessage({
      type: 'connection',
      message: 'qat',
      callback: ({ message }) => { message.value[5] = 'changed' }
    })
    dispatch.onMessage({
      type: 'connection',
      message: 'ir',
      callback: ({ message }) => { message.send = false }
    })

    game.send(LOGIN)
    const login = JSON.parse(await game.waitFor('"_cmd":"login"'))
    assert.equal(login.b.o.params.accountType, 2)

    game.send('%xt%o%ir%844480%55%')
    game.send('%xt%o%qat%844480%questready%0%')
    await server.waitFor('%xt%o%qat%')
    assert.ok(server.received.includes('%xt%o%qat%844480%changed%0%'))
    assert.ok(!server.received.some(t => t.includes('%ir%')))
  } finally { await done() }
})

test('async hooks keep packet order', async () => {
  const { server, dispatch, game, done } = await setup()
  try {
    dispatch.onMessage({
      type: 'connection',
      message: 'a',
      callback: async () => { await sleep(60) }
    })
    game.send('%xt%o%a%1%')
    game.send('%xt%o%b%1%')
    game.send('%xt%o%c%1%')
    await server.waitFor('%xt%o%c%')
    const order = server.received.filter(t => t.startsWith('%xt%o%')).map(t => t.split('%')[3])
    assert.deepEqual(order, ['a', 'b', 'c'])
  } finally { await done() }
})

test('a broken plugin hook is logged and the packet still goes through', async () => {
  const { server, dispatch, game, logs, done } = await setup()
  try {
    dispatch.onMessage({ type: 'connection', message: 'x', callback: () => { throw new Error('boom') } })
    game.send('%xt%o%x%1%')
    await server.waitFor('%xt%o%x%1%')
    assert.ok(logs.some(l => l.type === 'error' && /boom/.test(l.message)))
  } finally { await done() }
})

test('every-packet hooks, offMessage and the hooks map', async () => {
  const { server, dispatch, game, done } = await setup()
  try {
    const seen = []
    const all = ({ type, message }) => seen.push(`${type}:${message.type}`)
    dispatch.onMessage({ type: '*', callback: all })
    game.send('%xt%o%rj%-1%denA%')
    await game.waitFor('%xt%rj%')
    await sleep(20)
    assert.deepEqual(seen, ['connection:rj', 'aj:rj'])

    // Plugins written for Jam Reborn remove hooks straight from the map.
    const list = dispatch.hooks.aj.get('*')
    list.splice(list.indexOf(all), 1)
    dispatch.offMessage({ type: 'connection', callback: all })
    game.send('%xt%o%rj%-1%denB%')
    await server.waitFor('denB')
    await sleep(20)
    assert.equal(seen.length, 2)
  } finally { await done() }
})

test('sending from plugins, onPacket and serverMessage', async () => {
  const { server, dispatch, game, done } = await setup()
  try {
    const packets = []
    const stop = dispatch.onPacket(p => packets.push(p))
    game.send('%xt%o%rj%-1%denA%')
    await game.waitFor('%xt%rj%')

    await dispatch.sendRemoteMessage('%xt%o%qat%844480%questready%0%')
    await server.waitFor('questready')
    dispatch.sendConnectionMessage('%xt%ua%local only%0%')
    dispatch.serverMessage('Hello 100%')
    await game.waitFor('%xt%ua%Hello 100%0%')
    await game.waitFor('local only')
    assert.ok(!server.received.some(t => t.includes('local only')))

    const fromPlugin = packets.filter(p => p.fromPlugin)
    assert.deepEqual(fromPlugin.map(p => [p.direction, p.type]), [['out', 'qat'], ['in', 'ua'], ['in', 'ua']])
    assert.ok(packets.some(p => !p.fromPlugin && p.direction === 'in' && p.type === 'rj'))
    stop()
    const count = packets.length
    dispatch.serverMessage('again')
    assert.equal(packets.length, count)
  } finally { await done() }
})

test('plugin packets to the server are rate limited, not dropped', async () => {
  const { server, dispatch, game, done } = await setup({ packetsPerSecond: 5 })
  try {
    game.send('%xt%o%rj%-1%denA%')
    await game.waitFor('%xt%rj%')
    const started = Date.now()
    await dispatch.sendMultipleMessages({ messages: Array.from({ length: 7 }, (_, i) => `%xt%o%n%1%${i}%`) })
    await server.waitFor('%xt%o%n%1%6%')
    assert.ok(Date.now() - started >= 900, 'the last 2 waited for the next second')
    assert.equal(server.received.filter(t => t.startsWith('%xt%o%n%')).length, 7)
  } finally { await done() }
})

test('answers Flash policy requests without touching the game session', async () => {
  const { proxy, dispatch, game, done } = await setup()
  try {
    game.send('%xt%o%rj%-1%denA%')
    await game.waitFor('%xt%rj%')
    const policy = await new FakeGame(proxy.port).connect()
    policy.send('<policy-file-request/>')
    assert.equal(await policy.waitFor('cross-domain-policy'), POLICY)
    await policy.closed
    assert.equal(dispatch.connected, true)
  } finally { await done() }
})

test('disconnects cleanly and reconnects', async () => {
  const { server, proxy, dispatch, game, done } = await setup()
  try {
    game.send('%xt%o%rj%-1%denA%')
    await game.waitFor('%xt%rj%')
    const ended = new Promise(resolve => proxy.once('close-session', resolve))
    server.drop()
    assert.match(await ended, /server disconnected/)
    await game.closed
    assert.equal(dispatch.connected, false)
    await assert.rejects(dispatch.sendRemoteMessage('%xt%o%x%1%'), /Not connected/)
    assert.throws(() => dispatch.sendConnectionMessage('%xt%x%'), /Not connected/)

    const again = await new FakeGame(proxy.port).connect()
    again.send('%xt%o%rj%-1%denB%')
    await again.waitFor('denB')
    assert.equal(dispatch.connected, true)
    again.close()
  } finally { await done() }
})

test('a second game connection replaces the first', async () => {
  const { proxy, game, done } = await setup()
  try {
    game.send('%xt%o%rj%-1%denA%')
    await game.waitFor('%xt%rj%')
    const second = await new FakeGame(proxy.port).connect()
    second.send('%xt%o%rj%-1%denB%')
    await second.waitFor('denB')
    await game.closed
    second.close()
  } finally { await done() }
})

test('refuses an untrusted server certificate by default', async () => {
  const server = await new FakeServer({ secure: true }).start()
  const dispatch = new Dispatch({ log: () => {} })
  const proxy = new Proxy({ dispatch, upstream: () => ({ host: '127.0.0.1', port: server.port }) })
  await proxy.listen()
  const reason = new Promise(resolve => proxy.once('close-session', resolve))
  const game = await new FakeGame(proxy.port).connect()
  game.send('%xt%o%x%1%')
  assert.match(await reason, /Server connection error/)
  assert.equal(server.received.length, 0)
  await proxy.close()
  await server.stop()
})

test('listen errors are friendly', async () => {
  const dispatch = new Dispatch()
  const a = new Proxy({ dispatch, upstream: () => ({}) })
  const port = await a.listen()
  const b = new Proxy({ dispatch, upstream: () => ({}), port })
  await assert.rejects(b.listen(), /already in use/)
  await a.close()
})

test('console commands', async () => {
  const dispatch = new Dispatch()
  let got
  dispatch.onCommand({ name: 'Hello', callback: ({ parameters }) => { got = parameters } })
  assert.equal(await dispatch.runCommand('!hello big world'), true)
  assert.deepEqual(got, ['big', 'world'])
  assert.equal(await dispatch.runCommand('nope'), false)
  dispatch.offCommand({ name: 'hello' })
  assert.equal(await dispatch.runCommand('hello'), false)
})
