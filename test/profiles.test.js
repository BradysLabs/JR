'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { ProfileStore } = require('../src/profiles/store')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jr-profiles-'))

test('create, list, rename, recolor and remove profiles', () => {
  const store = new ProfileStore(tmp())
  assert.deepEqual(store.list(), [])
  const main = store.create('  Main  ')
  const alt = store.create('Alt Account')
  assert.equal(main.name, 'Main')
  assert.match(main.id, /^main-[0-9a-f]{6}$/)
  assert.notEqual(main.color, alt.color)
  assert.ok(fs.existsSync(store.dirOf(main.id)))
  assert.equal(store.list().length, 2)

  assert.throws(() => store.create('main'), /already a profile/)
  assert.throws(() => store.create(''), /Give the profile a name/)
  assert.throws(() => store.create('x'.repeat(25)), /up to 24/)

  store.rename(alt.id, 'Trading')
  assert.equal(store.get(alt.id).name, 'Trading')
  assert.throws(() => store.rename(alt.id, 'MAIN'), /already a profile/)
  store.setColor(alt.id, '#86efac')
  assert.equal(store.get(alt.id).color, '#86efac')

  assert.equal(store.remove(alt.id), true)
  assert.equal(store.list().length, 1)
  assert.ok(!fs.existsSync(store.dirOf(alt.id)))
})

test('a profile can only be open once, and most recent comes first', () => {
  const store = new ProfileStore(tmp())
  const a = store.create('A')
  const b = store.create('B')
  const releaseA = store.open(a.id)
  assert.throws(() => store.open(a.id), /already open/)
  assert.equal(store.isOpen(a.id), true)
  assert.throws(() => store.remove(a.id), /Close that profile/)

  const releaseB = store.open(b.id)
  assert.deepEqual(store.list().map(p => [p.name, p.open]), [['B', true], ['A', true]])
  releaseA()
  releaseA()
  assert.equal(store.isOpen(a.id), false)
  store.open(a.id)()
  releaseB()
})

test('a lock left by a crashed JR is taken over', () => {
  const store = new ProfileStore(tmp())
  const a = store.create('A')
  // A pid that is not running.
  fs.writeFileSync(path.join(store.dirOf(a.id), 'profile.lock'), '999999999')
  assert.equal(store.isOpen(a.id), false)
  const release = store.open(a.id)
  assert.equal(fs.readFileSync(path.join(store.dirOf(a.id), 'profile.lock'), 'utf8'), String(process.pid))
  release()
})

test('a lock held by another running process is respected', () => {
  const store = new ProfileStore(tmp())
  const a = store.create('A')
  fs.writeFileSync(path.join(store.dirOf(a.id), 'profile.lock'), String(process.ppid))
  assert.throws(() => store.open(a.id), /already open in another JR window/)
})

test('a broken profiles.json does not crash JR', () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, 'profiles.json'), '{oops')
  const store = new ProfileStore(root)
  assert.deepEqual(store.list(), [])
  store.create('Fresh')
  assert.equal(store.list().length, 1)
})

test('profile ids cannot escape the profiles folder', () => {
  const store = new ProfileStore(tmp())
  assert.throws(() => store.dirOf('../../etc'), /Bad profile id/)
})
