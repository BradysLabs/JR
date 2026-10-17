'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Dispatch } = require('../src/engine/dispatch')
const { Proxy } = require('../src/engine/proxy')
const { PluginHost } = require('../src/plugins/host')
const { readManifest } = require('../src/plugins/manifest')
const { ProfileStore } = require('../src/profiles/store')
const { FakeServer, FakeGame, sleep } = require('./helpers/fake-aj')
const Spammer = require('../plugins/packet-spammer/runner')

const BUILT_IN = path.join(__dirname, '..', 'plugins')
const tmp = (p = 'jr-plugins-') => fs.mkdtempSync(path.join(os.tmpdir(), p))

function writePlugin (folder, name, files) {
  const dir = path.join(folder, name)
  fs.mkdirSync(dir, { recursive: true })
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), typeof content === 'string' ? content : JSON.stringify(content))
  }
  return dir
}

function makeApp () {
  const messages = []
  return { messages, consoleMessage: (m) => messages.push(m) }
}

function makeHost ({ userFolder, profileDir, dispatch = new Dispatch(), application = makeApp() }) {
  const folders = [{ path: BUILT_IN, builtIn: true }]
  if (userFolder) folders.push({ path: userFolder })
  return new PluginHost({ folders, profileDir, dispatch, application, log: () => {} })
}

test('built-in plugins load and run without approval', () => {
  const host = makeHost({ profileDir: tmp() })
  const list = host.load()
  const byId = Object.fromEntries(list.map(p => [p.id, p]))
  assert.equal(byId.membership.status, 'running')
  assert.equal(byId.membership.author, 'BradysLabs')
  assert.equal(byId['packet-spammer'].status, 'ready')
  assert.equal(byId['packet-spammer'].type, 'ui')
  host.unloadAll()
})

test('manifests: Jam Reborn style plugin.json without type/main still loads', () => {
  const folder = tmp()
  const dir = writePlugin(folder, 'old', { 'plugin.json': { name: 'Old' }, 'index.js': 'module.exports = () => {}' })
  const m = readManifest(dir)
  assert.equal(m.ok, true)
  assert.equal(m.manifest.type, 'game')
  assert.equal(m.manifest.main, 'index.js')

  const ui = writePlugin(folder, 'ui', { 'plugin.json': { name: 'UI' }, 'index.html': '<p>' })
  assert.equal(readManifest(ui).manifest.type, 'ui')

  const bad = writePlugin(folder, 'bad', { 'plugin.json': { name: 'Bad', main: '../../evil.js', type: 'wat' } })
  const r = readManifest(bad)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => /inside the plugin folder/.test(e)))
  assert.ok(r.errors.some(e => /"type"/.test(e)))

  const broken = writePlugin(folder, 'broken', { 'plugin.json': '{nope' })
  assert.match(readManifest(broken).errors[0], /isn't valid JSON/)
})

test('other plugins need approval, and again after their files change', () => {
  const user = tmp()
  const profileDir = tmp()
  const dir = writePlugin(user, 'counter', {
    'plugin.json': { name: 'Counter', type: 'game', main: 'index.js' },
    'index.js': "module.exports = ({ dispatch }) => { dispatch.onCommand({ name: 'count', callback: () => {} }) }"
  })
  const dispatch = new Dispatch()
  const host = makeHost({ userFolder: user, profileDir, dispatch })
  host.load()
  assert.equal(host.get('counter').status, 'needs-approval')
  assert.equal(dispatch.commands.has('count'), false)

  host.approve('counter')
  assert.equal(host.get('counter').status, 'running')
  assert.equal(dispatch.commands.has('count'), true)

  host.turnOff('counter')
  assert.equal(host.get('counter').status, 'off')
  assert.equal(dispatch.commands.has('count'), false, 'turning off removes what it added')
  host.turnOn('counter')
  assert.equal(host.get('counter').status, 'running')

  fs.appendFileSync(path.join(dir, 'index.js'), '\n// changed\n')
  host.load()
  assert.equal(host.get('counter').status, 'changed')
  assert.equal(dispatch.commands.has('count'), false)
  host.approve('counter')
  assert.equal(host.get('counter').status, 'running')
  host.unloadAll()
})

test('approvals belong to one profile', () => {
  const user = tmp()
  writePlugin(user, 'p', { 'plugin.json': { name: 'P' }, 'index.js': 'module.exports = () => {}' })
  const one = makeHost({ userFolder: user, profileDir: tmp() })
  const two = makeHost({ userFolder: user, profileDir: tmp() })
  one.load(); two.load()
  one.approve('p')
  assert.equal(one.get('p').status, 'running')
  two.load()
  assert.equal(two.get('p').status, 'needs-approval')
  one.unloadAll()
})

test('plugin data never overlaps between profiles', () => {
  const root = tmp()
  const profiles = new ProfileStore(root)
  const main = profiles.create('Main')
  const alt = profiles.create('Alt')
  const user = tmp()
  writePlugin(user, 'notes', {
    'plugin.json': { name: 'Notes' },
    'index.js': `module.exports = ({ storage, dataPath, dispatch }) => {
      storage.set('opened', (storage.get('opened', 0)) + 1)
      require('fs').mkdirSync(dataPath, { recursive: true })
      require('fs').writeFileSync(require('path').join(dataPath, 'log.txt'), dispatch === undefined ? '' : 'x')
    }`
  })
  const hostFor = (p) => {
    const h = makeHost({ userFolder: user, profileDir: profiles.dirOf(p.id) })
    h.load(); h.approve('notes'); h.unloadAll()
    return h
  }
  hostFor(main); hostFor(main); hostFor(alt)

  const dataOf = (p) => JSON.parse(fs.readFileSync(path.join(profiles.dirOf(p.id), 'plugin-data', 'notes', 'storage.json'), 'utf8'))
  assert.deepEqual(dataOf(main), { opened: 2 })
  assert.deepEqual(dataOf(alt), { opened: 1 })
  assert.ok(fs.existsSync(path.join(profiles.dirOf(alt.id), 'plugin-data', 'notes', 'log.txt')))
  assert.notEqual(profiles.dirOf(main.id), profiles.dirOf(alt.id))
})

test('a plugin that throws is marked as an error and cleaned up', () => {
  const user = tmp()
  writePlugin(user, 'crash', {
    'plugin.json': { name: 'Crash' },
    'index.js': "module.exports = ({ dispatch }) => { dispatch.onMessage({ type: 'aj', message: 'zz', callback: () => {} }); throw new Error('nope') }"
  })
  const dispatch = new Dispatch()
  const host = makeHost({ userFolder: user, profileDir: tmp(), dispatch })
  host.load()
  host.approve('crash')
  assert.equal(host.get('crash').status, 'error')
  assert.deepEqual(host.get('crash').errors, ['nope'])
  assert.equal(dispatch.hooks.aj.has('zz'), false)
})

test('class plugins and stop functions', () => {
  const user = tmp()
  writePlugin(user, 'klass', {
    'plugin.json': { name: 'Klass' },
    'index.js': "module.exports = class { constructor ({ dispatch }) { dispatch.setState('klass', 'on'); this.d = dispatch } dispose () { this.d.setState('klass', 'off') } }"
  })
  const dispatch = new Dispatch()
  const host = makeHost({ userFolder: user, profileDir: tmp(), dispatch })
  host.load(); host.approve('klass')
  assert.equal(dispatch.getState('klass'), 'on')
  host.unloadAll()
  assert.equal(dispatch.getState('klass'), 'off')
})

test('closing a plugin window removes its hooks and packet watchers', () => {
  const dispatch = new Dispatch()
  const host = makeHost({ profileDir: tmp(), dispatch })
  host.load()
  const jam = host.openWindow('packet-spammer')
  assert.ok(jam.entry.endsWith(path.join('packet-spammer', 'index.html')))
  const cb = () => {}
  jam.dispatch.onMessage({ type: 'aj', message: 'uc', callback: cb })
  jam.onPacket(() => {})
  assert.equal(dispatch.hooks.aj.get('uc').length, 1)
  assert.equal(dispatch._watchers.size, 1)
  jam.dispose()
  assert.equal(dispatch.hooks.aj.has('uc'), false)
  assert.equal(dispatch._watchers.size, 0)
  assert.throws(() => host.openWindow('membership'), /can't open/)
})

test('Membership turns your login into a member login, and can be turned off', async () => {
  const server = await new FakeServer().start()
  const dispatch = new Dispatch()
  const proxy = new Proxy({ dispatch, upstream: () => server.target })
  await proxy.listen()
  const app = makeApp()
  const host = makeHost({ profileDir: tmp(), dispatch, application: app })
  host.load()
  const LOGIN = "<msg t='sys'><body action='login' r='0'></body></msg>"
  try {
    let game = await new FakeGame(proxy.port).connect()
    game.send(LOGIN)
    let login = JSON.parse(await game.waitFor('"_cmd":"login"'))
    assert.equal(login.b.o.params.accountType, 2)
    game.close()
    await game.closed

    await dispatch.runCommand('membership off')
    assert.match(app.messages.at(-1).message, /Membership is off/)
    game = await new FakeGame(proxy.port).connect()
    game.send(LOGIN)
    login = JSON.parse(await game.waitFor('"_cmd":"login"'))
    assert.equal(login.b.o.params.accountType, 1)
    game.close()
  } finally {
    host.unloadAll()
    await proxy.close()
    await server.stop()
  }
})

test('Packet Spammer: splitting, {room}, running and stopping', async () => {
  assert.deepEqual(Spammer.splitPackets(' %xt%o%a%1%\n\n  %xt%o%b%1% \r\n'), ['%xt%o%a%1%', '%xt%o%b%1%'])

  const sent = []
  const fake = {
    state: {},
    getState (k) { return this.state[k] },
    sendRemoteMessage: async (t) => { sent.push(['server', t]) },
    sendConnectionMessage: (t) => { sent.push(['game', t]) }
  }
  assert.throws(() => Spammer.fill('%xt%o%x%{room}%', fake), /Join a room first/)
  fake.state.room = '844480'

  const steps = [{ to: 'server', text: '%xt%o%qat%{room}%a%', delay: 0 }, { to: 'game', text: '%xt%ua%hi%0%', delay: 0 }]
  await Spammer.run(fake, steps, { wait: () => Promise.resolve() }).done
  assert.deepEqual(sent, [['server', '%xt%o%qat%844480%a%'], ['game', '%xt%ua%hi%0%']])

  sent.length = 0
  let steps2 = 0
  const looping = Spammer.run(fake, steps, { loop: true, wait: () => sleep(1), onStep: () => { if (++steps2 === 5) looping.stop() } })
  await looping.done
  assert.equal(sent.length, 5)

  const errors = []
  delete fake.state.room
  await Spammer.run(fake, steps, { onError: (e) => errors.push(e.message), wait: () => Promise.resolve() }).done
  assert.match(errors[0], /Join a room first/)
})
