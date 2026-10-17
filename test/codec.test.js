'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { decode, xml, Framer, frame, xtOut, xtIn } = require('../src/engine/codec')
const { Limiter } = require('../src/engine/limiter')

test('xt packets: command index depends on direction', () => {
  const out = decode('%xt%o%rj%844480%denName%', 'out')
  assert.equal(out.format, 'xt')
  assert.equal(out.type, 'rj')
  assert.equal(out.value[4], '844480')

  const inc = decode('%xt%rj%-1%1%denName%844480%', 'in')
  assert.equal(inc.type, 'rj')
  assert.equal(inc.value[6], '844480')
})

test('xt packets round-trip and pick up changes', () => {
  const raw = '%xt%o%iu%3588075%1%1%6%5%'
  const p = decode(raw, 'out')
  assert.equal(p.toMessage(), raw)
  p.value[7] = '9'
  assert.equal(p.toMessage(), '%xt%o%iu%3588075%1%1%9%5%')
})

test('json packets expose b.o._cmd as the type', () => {
  const raw = JSON.stringify({ t: 'xt', b: { r: -1, o: { _cmd: 'login', params: { accountType: 1 } } } })
  const p = decode(raw, 'in')
  assert.equal(p.format, 'json')
  assert.equal(p.type, 'login')
  p.value.b.o.params.accountType = 2
  assert.equal(JSON.parse(p.toMessage()).b.o.params.accountType, 2)
})

test('broken json falls back to text', () => {
  const p = decode('{"t":', 'in')
  assert.equal(p.format, 'text')
  assert.equal(p.toMessage(), '{"t":')
})

test('xml packets: action is the type, CDATA survives', () => {
  const raw = "<msg t='sys'><body action='login' r='0'><login z='sbiLogin'><nick><![CDATA[Jam<mer>]]></nick><pword><![CDATA[x]]></pword></login></body></msg>"
  const p = decode(raw, 'out')
  assert.equal(p.format, 'xml')
  assert.equal(p.type, 'login')
  assert.equal(xml.text(xml.find(p.value, 'nick')), 'Jam<mer>')
  assert.equal(p.toMessage(), raw)
  assert.equal(xml.stringify(xml.parse(p.toMessage())), p.toMessage())
})

test('xml self-closing tags, entities and double quotes', () => {
  const el = xml.parse('<msg t="sys"><body action="verChk" r="0"><ver v="165"/></body><x>a &amp; b</x></msg>')
  assert.equal(xml.commandOf(el), 'verChk')
  assert.equal(xml.find(el, 'ver').attrs.v, '165')
  assert.equal(xml.text(xml.find(el, 'x')), 'a & b')
  assert.match(xml.stringify(el), /<ver v='165' \/>/)
})

test('policy request is recognised', () => {
  assert.equal(decode('<policy-file-request/>', 'out').type, 'policy-file-request')
})

test('bad xml falls back to text', () => {
  assert.equal(decode('<msg><body></msg>', 'in').format, 'text')
})

test('framer: split, joined and multi-byte chunks', () => {
  const f = new Framer()
  assert.deepEqual(f.push(Buffer.from('%xt%a%')), [])
  assert.deepEqual(f.push(Buffer.from('1%\0%xt%b%\0%xt')), ['%xt%a%1%', '%xt%b%'])
  const heart = Buffer.from('%xt%c%♥%\0', 'utf8')
  assert.deepEqual(f.push(heart.subarray(0, 8)), [])
  assert.deepEqual(f.push(heart.subarray(8)), ['%xt%xt%c%♥%'])
})

test('framer refuses endless messages', () => {
  const f = new Framer({ maxLength: 10 })
  assert.throws(() => f.push('x'.repeat(20)), /too long/)
})

test('frame adds exactly one NUL', () => {
  assert.equal(frame('a').toString(), 'a\0')
  assert.equal(frame('a\0').toString(), 'a\0')
})

test('builders', () => {
  assert.equal(xtOut('rj', 123, 'denX'), '%xt%o%rj%123%denX%')
  assert.equal(xtOut('qat', 5), '%xt%o%qat%5%')
  assert.equal(xtIn('ua', 'Hi', 0), '%xt%ua%Hi%0%')
})

test('limiter spaces jobs out instead of dropping them', async () => {
  let t = 0
  const timers = []
  const limiter = new Limiter({
    perSecond: 2,
    now: () => t,
    setTimer: (fn, ms) => { timers.push({ fn, at: t + ms }); return timers.length },
    clearTimer: () => {}
  })
  const ran = []
  const jobs = [1, 2, 3, 4, 5].map(n => limiter.run(() => ran.push([n, t])))
  await Promise.resolve()
  assert.deepEqual(ran.map(r => r[0]), [1, 2])
  assert.equal(limiter.pending, 3)
  t = 1000; timers.shift().fn()
  assert.deepEqual(ran.map(r => r[0]), [1, 2, 3, 4])
  t = 2000; timers.shift().fn()
  await Promise.all(jobs)
  assert.deepEqual(ran, [[1, 0], [2, 0], [3, 1000], [4, 1000], [5, 2000]])
})

test('limiter.clear rejects waiting jobs', async () => {
  const limiter = new Limiter({ perSecond: 1 })
  await limiter.run(() => {})
  const waiting = limiter.run(() => {})
  limiter.clear('Disconnected')
  await assert.rejects(waiting, /Disconnected/)
})

test('unchanged xml and json pass through byte for byte', () => {
  const rawXml = "<msg t='sys'><body action='rndK' r='-1'></body></msg>"
  assert.equal(decode(rawXml, 'out').toMessage(), rawXml)
  const changed = decode(rawXml, 'out')
  changed.value.children[0].attrs.r = '5'
  assert.match(changed.toMessage(), /r='5'/)
  const rawJson = '{"t":"xt","b":{"r":-1,"o":{"_cmd":"x","n":1.0}}}'
  assert.equal(decode(rawJson, 'in').toMessage(), rawJson)
})
