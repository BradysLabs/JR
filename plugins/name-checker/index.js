/*
 * Name Checker
 *
 * Checks which usernames are free, the same way Animal Jam's sign-up screen
 * does: it opens its own connection to the game server, logs into the
 * sign-up zone (no account needed) and asks "is this name available?" for
 * each name.
 *
 *   -> %xt%a%la%-1%0%<name>%0%0%0%0%<deployVersion>%
 *   <- %xt%la%-1%<code>%...  1 = available, -2 / -3 = taken (-3 comes
 *                            with name suggestions), anything else = rejected
 *
 * Search types: short combos, dictionary words, themed words, first names,
 * patterns, repeats or your own list. Each search keeps its own progress,
 * so you can close the window and pick up where you left
 * off. Free names are added to available.txt in this folder as they're found.
 */
(() => {
  const tls = require('tls')
  const net = require('net')
  const dns = require('dns')
  const fs = require('fs')
  const path = require('path')
  const https = require('https')
  const { fileURLToPath } = require('url')

  const FOLDER = fileURLToPath(new URL('.', location.href))
  const STATE_FILE = path.join(FOLDER, 'progress.json')
  const FOUND_FILE = path.join(FOLDER, 'available.txt')

  const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
  const NUMBERS = '0123456789'
  const NAME_RULE = /^[a-z0-9]{3,20}$/i
  const DEFAULT_HOST = 'lb-iss02-classic-prod.animaljam.com'
  const REPLY_TIMEOUT = 10000
  const MIN_DELAY = 500

  const $ = id => document.getElementById(id)

  // ---------------------------------------------------------------- helpers

  function jamRef () {
    return window.jam || (window.opener && window.opener.jam) || null
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

  function log (text, kind = '') {
    const el = $('log')
    const line = document.createElement('div')
    if (kind) line.className = kind
    line.textContent = `${new Date().toTimeString().slice(0, 8)}  ${text}`
    el.appendChild(line)
    while (el.childNodes.length > 300) el.removeChild(el.firstChild)
    el.scrollTop = el.scrollHeight
  }

  function formatTime (ms) {
    if (!isFinite(ms) || ms <= 0) return '–'
    const mins = Math.round(ms / 60000)
    if (mins < 1) return '<1m'
    const h = Math.floor(mins / 60)
    const m = mins % 60
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
    return h ? `${h}h ${m}m` : `${m}m`
  }

  function getJson (url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) AJClassic/1.5.4 Chrome/87.0.4280.141 Electron/11.5.0 Safari/537.36'
        },
        timeout: 15000
      }, res => {
        let body = ''
        res.on('data', chunk => { body += chunk })
        res.on('end', () => {
          try { resolve(JSON.parse(body)) } catch (err) { reject(new Error('Bad response from animaljam.com')) }
        })
      })
      req.on('timeout', () => req.destroy(new Error('animaljam.com timed out')))
      req.on('error', reject)
    })
  }

  async function fetchServerInfo () {
    const vars = await getJson('https://www.animaljam.com/flashvars')
    const deploy = vars && vars.deploy_version ? String(vars.deploy_version) : null
    if (!deploy) throw new Error("Couldn't read the game version from animaljam.com")

    let host = null
    if (vars.smartfoxServer) {
      host = 'lb-' + String(vars.smartfoxServer).replace(/\.(stage|prod)\.animaljam\.internal$/, '-$1.animaljam.com')
    }
    return { deploy, host }
  }

  // Same as Jam's own client: skip a hosts-file redirect back to this PC.
  async function resolveHost (host) {
    if (net.isIP(host)) return host
    try {
      const { address } = await dns.promises.lookup(host, { family: 4 })
      if (!address.startsWith('127.') && address !== '0.0.0.0') return address
    } catch (_) {}
    const resolver = new dns.promises.Resolver()
    resolver.setServers(['1.1.1.1', '8.8.8.8'])
    const [address] = await resolver.resolve4(host)
    return address
  }

  // ------------------------------------------------------------- connection

  class SignupConnection {
    constructor (host, deploy) {
      this.host = host
      this.deploy = deploy
      this.socket = null
      this.buffer = ''
      this.waiters = []
      this.closed = true
    }

    async open () {
      const address = await resolveHost(this.host)
      await new Promise((resolve, reject) => {
        const socket = tls.connect({
          host: address,
          port: 443,
          servername: net.isIP(this.host) ? undefined : this.host
        })
        const fail = err => { socket.destroy(); reject(err) }
        socket.setTimeout(REPLY_TIMEOUT, () => fail(new Error('Connection timed out')))
        socket.once('error', fail)
        socket.once('secureConnect', () => {
          socket.setTimeout(0)
          socket.removeListener('error', fail)
          resolve()
        })
        this.socket = socket
      })

      this.closed = false
      this.socket.on('data', data => this._onData(data))
      this.socket.on('error', () => {})
      this.socket.on('close', () => {
        this.closed = true
        this.waiters.splice(0).forEach(w => w.reject(new Error('Disconnected')))
      })

      this._send("<msg t='sys'><body action='verChk' r='0'><ver v='165' /></body></msg>")
      const ver = await this._wait(m => /apiOK|apiKO/.test(m))
      if (ver.includes('apiKO')) throw new Error('Server refused the connection (version)')

      this._send("<msg t='sys'><body action='rndK' r='-1'></body></msg>")
      await this._wait(m => m.includes('rndK'))

      this._send("<msg t='sys'><body action='login' r='0'><login z='sbiAccountZone'><nick><![CDATA[]]></nick><pword><![CDATA[]]></pword></login></body></msg>")
      const login = await this._wait(m => /logOK|logKO|%xt%l%|"_cmd":"login"|rmList/.test(m))
      if (login.includes('logKO')) throw new Error('Server refused the sign-up login')
      await sleep(400)
    }

    async check (name) {
      this._send(`%xt%a%la%-1%0%${name}%0%0%0%0%${this.deploy}%`)
      const reply = await this._wait(m => m.startsWith('%xt%la%'))
      const parts = reply.split('%')
      return { code: parseInt(parts[4], 10), raw: reply }
    }

    close () {
      if (this.socket) this.socket.destroy()
      this.closed = true
    }

    _send (text) {
      if (!this.socket || this.socket.destroyed) throw new Error('Not connected')
      this.socket.write(text + '\0')
    }

    _onData (data) {
      this.buffer += data.toString('utf8')
      let end
      while ((end = this.buffer.indexOf('\0')) >= 0) {
        const message = this.buffer.slice(0, end)
        this.buffer = this.buffer.slice(end + 1)
        const index = this.waiters.findIndex(w => w.test(message))
        if (index >= 0) {
          const [waiter] = this.waiters.splice(index, 1)
          waiter.resolve(message)
        }
      }
    }

    _wait (test, timeout = REPLY_TIMEOUT) {
      return new Promise((resolve, reject) => {
        const waiter = {
          test,
          resolve: msg => { clearTimeout(timer); resolve(msg) },
          reject: err => { clearTimeout(timer); reject(err) }
        }
        const timer = setTimeout(() => {
          const i = this.waiters.indexOf(waiter)
          if (i >= 0) this.waiters.splice(i, 1)
          reject(new Error('No reply from server'))
        }, timeout)
        this.waiters.push(waiter)
      })
    }
  }

  // ------------------------------------------------------------ name lists

  let WORDS = { dictionary: [], names: [], themes: {} }
  try {
    WORDS = JSON.parse(fs.readFileSync(path.join(FOLDER, 'words.json'), 'utf8'))
  } catch (err) {
    setTimeout(() => log("Couldn't load words.json. Word searches won't work.", 'e'), 0)
  }

  const valid = name => NAME_RULE.test(name)
  const num = (id, fallback) => {
    const n = parseInt($(id).value, 10)
    return isFinite(n) ? n : fallback
  }
  const clean = id => $(id).value.toLowerCase().replace(/[^a-z0-9]/g, '')
  const range = (minId, maxId, lo, hi) => {
    let min = Math.min(hi, Math.max(lo, num(minId, lo)))
    let max = Math.min(hi, Math.max(lo, num(maxId, hi)))
    if (max < min) [min, max] = [max, min]
    return [min, max]
  }
  const withDigits = (list, on) => on ? list.concat(...'0123456789'.split('').map(d => list.map(w => w + d))) : list

  /**
   * Reads the form for the chosen search type. A job is plain data, so it can
   * be saved and compared to find saved progress.
   */
  function currentJob () {
    switch (type) {
      case 'short': {
        let chars = ''
        if ($('shortLetters').checked) chars += LETTERS
        if ($('shortNumbers').checked) chars += NUMBERS
        const [min, max] = range('shortMin', 'shortMax', 3, 6)
        return { type, chars, min, max }
      }
      case 'words': {
        const [min, max] = range('wordsMin', 'wordsMax', 3, 20)
        return { type, min, max, start: clean('wordsStart'), has: clean('wordsHas'), end: clean('wordsEnd') }
      }
      case 'themes': {
        const themes = [...document.querySelectorAll('#themeList input:checked')].map(el => el.value)
        return { type, themes, digit: $('themesDigit').checked }
      }
      case 'names': {
        const [min, max] = range('namesMin', 'namesMax', 3, 20)
        return { type, min, max, digit: $('namesDigit').checked }
      }
      case 'pattern': {
        const patterns = $('pattern').value.toLowerCase().split(',').map(p => p.replace(/[^a-z0-9?#*]/g, '')).filter(Boolean)
        return { type, patterns }
      }
      case 'repeats': {
        const [min, max] = range('repMin', 'repMax', 3, 20)
        return { type, min, max, same: $('repSame').checked, pair: $('repPair').checked }
      }
      default: {
        const names = [...new Set($('list').value.split(/[\s,]+/).map(n => n.trim().toLowerCase()).filter(Boolean))]
        return { type: 'list', names }
      }
    }
  }

  const jobKey = job => JSON.stringify(job)

  /**
   * Turns a job into a source: { total, at(index), problem }.
   * Big searches (short names, patterns) are computed on the fly instead of
   * being listed out, so even millions of names use no memory.
   */
  function makeSource (job) {
    const fromList = list => {
      const names = [...new Set(list.filter(valid))]
      return { total: names.length, at: i => names[i] }
    }
    const segments = segs => {
      const total = segs.reduce((sum, s) => sum + s.count, 0)
      return {
        total,
        at: i => {
          for (const s of segs) {
            if (i < s.count) return s.at(i)
            i -= s.count
          }
          return null
        }
      }
    }
    const product = slots => ({
      count: slots.reduce((n, choices) => n * choices.length, 1),
      at: i => {
        let name = ''
        for (let p = slots.length - 1; p >= 0; p--) {
          const choices = slots[p]
          name = choices[i % choices.length] + name
          i = Math.floor(i / choices.length)
        }
        return name
      }
    })

    switch (job.type) {
      case 'short': {
        if (!job.chars) return { total: 0, problem: 'Pick letters, numbers or both.' }
        const segs = []
        for (let len = job.min; len <= job.max; len++) segs.push(product(Array(len).fill(job.chars)))
        return segments(segs)
      }
      case 'words': {
        const list = WORDS.dictionary.filter(w =>
          w.length >= job.min && w.length <= job.max &&
          (!job.start || w.startsWith(job.start)) &&
          (!job.has || w.includes(job.has)) &&
          (!job.end || w.endsWith(job.end)))
        return { ...fromList(list), problem: list.length ? null : 'No dictionary words match those filters.' }
      }
      case 'themes': {
        if (!job.themes.length) return { total: 0, problem: 'Pick at least one theme.' }
        const base = [...new Set(job.themes.flatMap(t => WORDS.themes[t] || []))].sort((a, b) => a.length - b.length || a.localeCompare(b))
        return fromList(withDigits(base, job.digit))
      }
      case 'names': {
        const base = WORDS.names.filter(n => n.length >= job.min && n.length <= job.max)
        return { ...fromList(withDigits(base, job.digit)), problem: base.length ? null : 'No names that length.' }
      }
      case 'pattern': {
        const segs = []
        const bad = []
        for (const p of job.patterns) {
          if (p.length < 3 || p.length > 20) { bad.push(p); continue }
          segs.push(product([...p].map(ch =>
            ch === '?' ? LETTERS : ch === '#' ? NUMBERS : ch === '*' ? LETTERS + NUMBERS : ch)))
        }
        if (!segs.length) return { total: 0, problem: bad.length ? 'Patterns must be 3–20 characters long.' : 'Type a pattern.' }
        return { ...segments(segs), problem: bad.length ? `Skipping ${bad.join(', ')} (must be 3–20 characters).` : null }
      }
      case 'repeats': {
        const chars = (LETTERS + NUMBERS).split('')
        const list = []
        for (let len = job.min; len <= job.max; len++) {
          if (job.same) chars.forEach(c => list.push(c.repeat(len)))
          if (job.pair && len >= 4) {
            chars.forEach(a => chars.forEach(b => {
              if (a !== b) list.push((a + b).repeat(Math.ceil(len / 2)).slice(0, len))
            }))
          }
        }
        if (!job.same && !job.pair) return { total: 0, problem: 'Pick at least one kind of repeat.' }
        return fromList(list)
      }
      default: {
        const bad = job.names.filter(n => !valid(n))
        const src = fromList(job.names)
        if (!job.names.length) return { total: 0, problem: 'Paste some names first.' }
        return { ...src, problem: bad.length ? `Skipping ${bad.length} that can't exist (3–20 letters or numbers).` : null }
      }
    }
  }

  // ------------------------------------------------------------------ state

  let type = 'short'
  let running = false
  let stopRequested = false
  let timings = []
  let store = loadStore() // { lastJob, jobs: { [key]: progress } }

  function loadStore () {
    try {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
      if (data && data.jobs) return data
    } catch (_) {}
    return { lastJob: null, jobs: {} }
  }

  function saveStore () {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(store)) } catch (_) {}
  }

  function progressFor (job) {
    return store.jobs[jobKey(job)] || null
  }

  function ensureProgress (job) {
    const key = jobKey(job)
    if (!store.jobs[key]) store.jobs[key] = { index: 0, available: [], taken: 0, rejected: 0, updated: Date.now() }
    store.lastJob = job
    return store.jobs[key]
  }

  // --------------------------------------------------------------------- UI

  function renderPreview () {
    const job = currentJob()
    const src = makeSource(job)
    const delay = Math.max(MIN_DELAY, num('delay', 1200))
    const el = $('preview')
    if (!src.total) {
      el.innerHTML = `<span class="warn">${src.problem || 'Nothing to check.'}</span>`
      return
    }
    const samples = []
    const step = Math.max(1, Math.floor(src.total / 8))
    for (let i = 0; i < src.total && samples.length < 8; i += step) samples.push(src.at(i))
    const prog = progressFor(job)
    const left = src.total - (prog ? prog.index : 0)
    el.innerHTML =
      `<b>${src.total.toLocaleString()}</b> names` +
      (prog && prog.index ? ` (${left.toLocaleString()} left)` : '') +
      ` · about <b>${formatTime(left * (delay + 150))}</b>` +
      `<br>e.g. <span class="samples">${samples.join(', ')}</span>` +
      (src.problem ? `<br><span class="warn">${src.problem}</span>` : '') +
      (src.total > 200000 ? '<br><span class="warn">That\'s a very long search. Narrow it down, or plan to leave it running for days.</span>' : '')
  }

  function renderStats () {
    const job = currentJob()
    const src = makeSource(job)
    const prog = progressFor(job)
    const total = src.total
    const checked = prog ? prog.index : 0
    const left = Math.max(0, total - checked)
    $('sChecked').textContent = checked.toLocaleString()
    $('sFree').textContent = prog ? prog.available.length.toLocaleString() : '0'
    $('sTaken').textContent = prog ? (prog.taken + prog.rejected).toLocaleString() : '0'
    $('sLeft').textContent = left.toLocaleString()
    $('fill').style.width = total ? `${Math.min(100, (checked / total) * 100)}%` : '0'

    const avg = timings.length ? timings.reduce((a, b) => a + b, 0) / timings.length : 0
    $('sEta').textContent = running && avg ? formatTime(left * avg) : '–'

    const found = $('found')
    const names = prog ? prog.available : []
    if (!names.length) {
      found.innerHTML = '<span class="empty">None yet.</span>'
    } else if (found.childElementCount !== names.length || found.querySelector('.empty')) {
      found.innerHTML = ''
      names.forEach(name => {
        const chip = document.createElement('span')
        chip.className = 'chip'
        chip.textContent = name
        chip.title = 'Click to copy'
        chip.onclick = () => copy(name)
        found.appendChild(chip)
      })
    }

    if (!running) {
      $('start').textContent = checked > 0 && checked < total ? 'Resume' : 'Start'
      $('now').textContent = total && checked >= total ? 'Finished' : 'Not running'
    }
  }

  function render () {
    renderPreview()
    renderStats()
  }

  function setRunning (on, error = false) {
    running = on
    $('dot').className = 'dot' + (on ? ' live' : error ? ' err' : '')
    $('reset').disabled = on
    if (on) $('start').textContent = 'Pause'
    document.querySelectorAll('.type, [data-opts] input, [data-opts] textarea, [data-opts] select').forEach(el => { el.disabled = on })
    renderStats()
  }

  function setType (next) {
    type = next
    document.querySelectorAll('.type').forEach(b => b.classList.toggle('active', b.dataset.type === type))
    document.querySelectorAll('[data-opts]').forEach(el => el.classList.toggle('hidden', el.dataset.opts !== type))
    render()
  }

  function copy (text) {
    try {
      require('electron').clipboard.writeText(text)
    } catch (_) {
      navigator.clipboard && navigator.clipboard.writeText(text)
    }
    log(`Copied ${text.includes('\n') ? 'the list' : text}`, 'ok')
  }

  function buildThemeList () {
    const box = $('themeList')
    Object.keys(WORDS.themes).forEach((name, i) => {
      const label = document.createElement('label')
      label.innerHTML = `<input type="checkbox" value="${name}"${i === 0 ? ' checked' : ''}> ${name} <small>${WORDS.themes[name].length}</small>`
      box.appendChild(label)
    })
  }

  /** Puts the form back the way it was for the last search. */
  function restoreForm (job) {
    if (!job || !job.type) return
    const set = (id, v) => { if (v !== undefined && $(id)) $(id).value = v }
    const check = (id, v) => { if ($(id)) $(id).checked = !!v }
    switch (job.type) {
      case 'short': set('shortMin', job.min); set('shortMax', job.max); check('shortLetters', job.chars.includes('a')); check('shortNumbers', job.chars.includes('0')); break
      case 'words': set('wordsMin', job.min); set('wordsMax', job.max); set('wordsStart', job.start); set('wordsHas', job.has); set('wordsEnd', job.end); break
      case 'themes':
        document.querySelectorAll('#themeList input').forEach(el => { el.checked = job.themes.includes(el.value) })
        check('themesDigit', job.digit)
        break
      case 'names': set('namesMin', job.min); set('namesMax', job.max); check('namesDigit', job.digit); break
      case 'pattern': set('pattern', job.patterns.join(', ')); break
      case 'repeats': set('repMin', job.min); set('repMax', job.max); check('repSame', job.same); check('repPair', job.pair); break
      case 'list': set('list', job.names.join('\n')); break
    }
    setType(job.type)
  }

  // ---------------------------------------------------------------- runner

  async function run () {
    const job = currentJob()
    const src = makeSource(job)
    if (!src.total) return log(src.problem || 'Nothing to check.', 'w')

    const prog = ensureProgress(job)
    if (prog.index >= src.total) return log('This search is already finished. Press Reset to run it again.', 'w')
    saveStore()

    stopRequested = false
    timings = []
    setRunning(true)

    let info
    try {
      log('Getting the game version from animaljam.com…')
      info = await fetchServerInfo()
    } catch (err) {
      log(err.message, 'e')
      return setRunning(false, true)
    }

    const jam = jamRef()
    const host = info.host || (jam && jam.application.settings.get('smartfoxServer')) || DEFAULT_HOST
    let conn = null
    let failures = 0
    const delay = () => Math.max(MIN_DELAY, num('delay', 1200))

    while (!stopRequested && prog.index < src.total) {
      if (!conn || conn.closed) {
        try {
          $('now').textContent = 'Connecting…'
          conn = new SignupConnection(host, info.deploy)
          await conn.open()
          log(`Connected to ${host}`, 'ok')
          failures = 0
        } catch (err) {
          failures++
          conn && conn.close()
          conn = null
          const wait = Math.min(60000, 3000 * Math.pow(2, failures - 1))
          log(`${err.message}. Trying again in ${Math.round(wait / 1000)}s.`, 'e')
          if (failures >= 6) {
            log('Gave up after 6 tries. Check your internet and press Resume.', 'e')
            break
          }
          await sleep(wait)
          continue
        }
      }

      const name = src.at(prog.index)
      $('now').textContent = `Checking ${name}  (${(prog.index + 1).toLocaleString()} of ${src.total.toLocaleString()})`
      const started = Date.now()

      let code, raw
      try {
        ({ code, raw } = await conn.check(name))
        // Double-check hits so a stray reply can't make a false positive.
        if (code === 1) {
          await sleep(delay())
          const again = await conn.check(name)
          if (again.code !== 1) {
            log(`${name}: first said available, then said ${again.code}. Counting it as taken.`, 'w')
            code = again.code
            raw = again.raw
          }
        }
      } catch (err) {
        log(`${name}: ${err.message}. Reconnecting.`, 'w')
        conn.close()
        conn = null
        await sleep(3000)
        continue
      }

      if (code === -24) {
        log('The game updated. Getting the new version…', 'w')
        try { info = await fetchServerInfo() } catch (err) { log(err.message, 'e'); break }
        conn.deploy = info.deploy
        continue
      }

      if (code === 1) {
        prog.available.push(name)
        try { fs.appendFileSync(FOUND_FILE, name + '\n') } catch (_) {}
        log(`${name} is available!  (server: ${raw})`, 'ok')
      } else if (code === -2 || code === -3) {
        prog.taken++
      } else {
        prog.rejected++
        if (prog.rejected <= 5) log(`${name}: rejected, code ${code}  (server: ${raw})`, 'w')
      }
      prog.codes = prog.codes || {}
      prog.codes[code] = (prog.codes[code] || 0) + 1
      prog.index++
      prog.updated = Date.now()
      if (prog.index % 10 === 0) saveStore()

      await sleep(delay())
      timings.push(Date.now() - started)
      if (timings.length > 50) timings.shift()
      renderStats()
    }

    if (conn) conn.close()
    saveStore()
    if (prog.codes) {
      const label = c => c === '1' ? 'available' : c === '-2' || c === '-3' ? 'taken' : 'other'
      log('Server replies so far: ' + Object.entries(prog.codes).map(([c, n]) => `${c} (${label(c)}) ×${n.toLocaleString()}`).join(', '))
    }
    if (prog.index >= src.total) {
      log(`Done. ${prog.available.length} available out of ${src.total.toLocaleString()}.`, 'ok')
    } else if (stopRequested) {
      log('Paused. Press Resume to keep going.')
    }
    setRunning(false)
    renderPreview()
  }

  // ---------------------------------------------------------------- wiring

  buildThemeList()

  document.querySelectorAll('.type').forEach(btn => {
    btn.onclick = () => setType(btn.dataset.type)
  })

  let renderTimer = null
  const queueRender = () => {
    clearTimeout(renderTimer)
    renderTimer = setTimeout(() => { if (!running) render(); else renderPreview() }, 150)
  }
  document.querySelectorAll('[data-opts] input, [data-opts] textarea, #delay').forEach(el => {
    el.addEventListener('input', queueRender)
    el.addEventListener('change', queueRender)
  })

  $('start').onclick = () => {
    if (running) {
      stopRequested = true
      $('now').textContent = 'Pausing after this name…'
      return
    }
    run().catch(err => { log(err.message, 'e'); setRunning(false, true) })
  }

  $('reset').onclick = () => {
    const key = jobKey(currentJob())
    if (store.jobs[key]) {
      delete store.jobs[key]
      saveStore()
      log('Progress for this search cleared. available.txt was kept.')
    } else {
      log('Nothing to reset for this search.')
    }
    render()
  }

  $('copy').onclick = () => {
    const prog = progressFor(currentJob())
    if (prog && prog.available.length) copy(prog.available.join('\n'))
    else log('Nothing to copy yet.', 'w')
  }

  $('folder').onclick = () => {
    try { require('electron').shell.openPath(FOLDER) } catch (err) { log(err.message, 'e') }
  }

  window.addEventListener('beforeunload', () => {
    stopRequested = true
    saveStore()
  })

  setType('short')
  restoreForm(store.lastJob)
  setRunning(false)
  render()

  const last = store.lastJob && progressFor(store.lastJob)
  if (last && last.index > 0) {
    log(`Saved progress found: ${last.index.toLocaleString()} checked, ${last.available.length} available. Press Resume to continue.`)
  } else {
    log('Ready. Pick what to search for and press Start.')
  }
})()
