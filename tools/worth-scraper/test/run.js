/**
 * Tests for the worth scraper. Run: node test/run.js
 * 1. Reads sample pages built like the real wiki pages and checks the values.
 * 2. Runs the whole scraper against a fake copy of the wiki API.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { execFileSync } = require('child_process')
const { readPage } = require('../lib/tables')

const fx = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')
let passed = 0
const check = (label, fn) => { fn(); passed++; console.log('  ok  ' + label) }
const offer = (item, unit) => item.offers.find((o) => o.unit === unit)

console.log('Headdress (column per color):')
const hd = readPage(fx('headdress.html'), { title: 'Headdress', url: 'u' })
check('5 colors found', () => assert.deepStrictEqual(hd.items.map((i) => i.variant), ['Rare Item Monday', 'Dark Pink', 'Tan', 'Orange', 'Magenta']))
check('Magenta = 18-19 Black Long Collars and 19 Variety', () => {
  const m = hd.items.find((i) => i.variant === 'Magenta')
  assert.deepStrictEqual([offer(m, 'Black Long Collars').min, offer(m, 'Black Long Collars').max], [18, 19])
  assert.strictEqual(offer(m, 'Variety').min, 19)
})
check('Tan = 12-13 Black Long Collars', () => assert.strictEqual(offer(hd.items[2], 'Black Long Collars').max, 13))
check('each color has its own full-size picture', () => {
  assert.ok(hd.items[4].image.endsWith('/Magenta_Headdress.png/revision/latest?cb=20200916'), hd.items[4].image)
  assert.strictEqual(new Set(hd.items.map((i) => i.image)).size, 5)
})
check('last updated date read', () => assert.strictEqual(hd.lastUpdated, '2024-03-28'))
check('ids are stable and unique', () => assert.deepStrictEqual(hd.items.map((i) => i.id), ['headdress/rare-item-monday', 'headdress/dark-pink', 'headdress/tan', 'headdress/orange', 'headdress/magenta']))

console.log('Rare Long Spiked Collar (grades + OR offers + bundles):')
const rl = readPage(fx('rlsc.html'), { title: 'Rare Long Spiked Collar', url: 'u' })
const color = (c) => rl.items.find((i) => i.variant === c)
check('8 colors with grades', () => {
  assert.strictEqual(rl.items.length, 8)
  assert.deepStrictEqual(rl.items.map((i) => i.grade), ['Bad', 'Bad', 'Decent', 'Decent', 'Good', 'Good', 'Good', 'Best'])
})
check('grade row is not mistaken for a value', () => assert.ok(!color('Black').raw.includes('Best')))
check('Black = 80 Den Betas + two collar bundles', () => {
  const b = color('Black')
  assert.strictEqual(b.offers.length, 3)
  assert.strictEqual(offer(b, 'Den Betas').min, 80)
  assert.strictEqual(offer(b, 'Den Betas').note, 'depends on Jammer')
  assert.deepStrictEqual(b.offers[1].bundle.map((p) => [p.min, p.unit]), [[2, 'Red Long Collar'], [1, 'Bad Long Collar']])
  assert.deepStrictEqual([b.offers[2].min, b.offers[2].unit], [8, 'Bad Long Collar'])
})
check('Red has 4 alternative offers', () => assert.strictEqual(color('Red').offers.length, 4))
check('Orange bundle mixes a collar and Den Betas', () => {
  assert.deepStrictEqual(color('Orange').offers[1].bundle.map((p) => [p.min, p.max, p.unit]), [[1, 1, 'Black Short Collar'], [3, 4, 'Den Betas']])
})
check('"+ Add" understood', () => assert.ok(color('Green').offers[1].bundle[1].add))
check('last updated 9/16/20', () => assert.strictEqual(rl.lastUpdated, '2020-09-16'))

console.log('Alpha Set (row per item):')
const al = readPage(fx('alpha-set.html'), { title: 'Alpha Set', url: 'u' })
check('2 items read by name', () => assert.deepStrictEqual(al.items.map((i) => i.name), ['Alpha Sword', 'Alpha Helmet']))
check('Alpha Sword = 110+ Black Long Collars', () => {
  const s = offer(al.items[0], 'Black Long Collars')
  assert.deepStrictEqual([s.min, s.atLeast, s.note], [110, true, 'maybe more'])
})
check('extra columns kept, picture found', () => {
  assert.strictEqual(al.items[0].fields['Redeemed from'], 'Redeemed from 96 unique Adopt-A-Pets')
  assert.ok(al.items[0].image.includes('Alpha_Sword.png'))
})
check('edit links ignored in section names', () => assert.strictEqual(al.items[0].section, 'Items'))

console.log('Page without tables:')
check('no items, no crash', () => assert.strictEqual(readPage(fx('no-table.html'), { title: 'Rules', url: 'u' }).items.length, 0))

// ---- End to end against a fake wiki API ----
console.log('Full scrape against a fake wiki API:')
const pages = { Headdress: 'headdress.html', 'Rare Long Spiked Collar': 'rlsc.html', 'Alpha Set': 'alpha-set.html', Rules: 'no-table.html' }
const hits = { parse: 0, allpages: 0 }
let revBump = 0
const server = http.createServer((req, res) => {
  const q = new URL(req.url, 'http://x').searchParams
  assert.ok(/JRWorthCollector/.test(req.headers['user-agent']))
  let body
  if (q.get('list') === 'allpages') {
    hits.allpages++
    body = { query: { allpages: Object.keys(pages).map((title) => ({ title })) } }
  } else if (q.get('prop') === 'revisions') {
    body = { query: { pages: q.get('titles').split('|').map((title) => ({ title, revisions: [{ revid: title === 'Headdress' ? 100 + revBump : 1, timestamp: '2026-10-01T00:00:00Z' }] })) } }
  } else if (q.get('action') === 'parse') {
    hits.parse++
    const t = q.get('page')
    body = { parse: { title: t, revid: t === 'Headdress' ? 100 + revBump : 1, text: fs.readFileSync(path.join(__dirname, 'fixtures', pages[t]), 'utf8') } }
  } else {
    body = { error: { code: 'unknown', info: 'unknown request' } }
  }
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
})

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-worth-'))
  const run = () => new Promise((resolve, reject) => {
    const { execFile } = require('child_process')
    execFile(process.execPath, [path.join(__dirname, '..', 'scrape.js'), '--base', `http://127.0.0.1:${port}`, '--delay', '0', '--out', path.join(dir, 'values.json'), '--cache', path.join(dir, 'cache')],
      { env: { ...process.env, NO_PROXY: '*', no_proxy: '*', HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '' } },
      (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)))
  })
  ;(async () => {
    try {
      await run()
      const out = JSON.parse(fs.readFileSync(path.join(dir, 'values.json'), 'utf8'))
      const report = JSON.parse(fs.readFileSync(path.join(dir, 'values.report.json'), 'utf8'))
      check('all pages listed and read', () => assert.deepStrictEqual([hits.allpages, hits.parse], [1, 4]))
      check('15 items written', () => assert.strictEqual(out.itemCount, 15))
      check('report lists the page without tables', () => assert.deepStrictEqual(report.noTables, ['Rules']))
      check('units summary includes the main units', () => {
        const names = out.units.map((u) => u.name)
        for (const u of ['Den Betas', 'Black Long Collars', 'Variety']) assert.ok(names.includes(u), u)
      })
      check('every item links to its page', () => assert.ok(out.items.every((i) => i.url.includes('/wiki/'))))

      revBump = 1 // Headdress edited on the wiki
      await run()
      check('second run only re-downloads the edited page', () => assert.strictEqual(hits.parse, 5))
      console.log(`\n${passed} checks passed`)
    } catch (error) {
      console.error('\nFAILED:', error.message)
      process.exitCode = 1
    } finally {
      server.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })()
})
