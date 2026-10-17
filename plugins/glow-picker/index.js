const PRESETS = [
  { name: 'Hot Pink', hex: '#ff2fc8' },
  { name: 'Magenta', hex: '#ff00ff' },
  { name: 'Bright Red', hex: '#ff0000' },
  { name: 'Orange', hex: '#ff8a00' },
  { name: 'Gold', hex: '#ffc400' },
  { name: 'Yellow', hex: '#ffe600' },
  { name: 'Lime', hex: '#a6ff00' },
  { name: 'Green', hex: '#1aff4a' },
  { name: 'Cyan', hex: '#00e5ff' },
  { name: 'Blue', hex: '#0040ff' },
  { name: 'Purple', hex: '#9b30ff' },
  { name: 'Soft Pink', hex: '#ff4fa0' },
  { name: 'White', hex: '#ffffff' },
  { name: 'Black', hex: '#000000' }
]

// One-click swaps: the glow flips between these colors in order.
const SWAPS = [
  { name: 'Red & Blue', colors: ['#ff0000', '#0040ff'] },
  { name: 'Black & White', colors: ['#000000', '#ffffff'] },
  { name: 'Christmas', colors: ['#ff0000', '#1aff4a'] },
  { name: 'Neon', colors: ['#ff2fc8', '#00e5ff'] },
  { name: 'Fire', colors: ['#ff0000', '#ff8a00', '#ffe600'] },
  { name: 'Ice', colors: ['#00e5ff', '#ffffff'] },
  { name: 'Gold & Black', colors: ['#ffc400', '#000000'] },
  { name: 'Halloween', colors: ['#ff8a00', '#9b30ff'] },
  { name: 'Ocean', colors: ['#0040ff', '#00e5ff', '#00b3a4'] },
  { name: 'Candy', colors: ['#ff4fa0', '#ffffff'] },
  { name: 'Rainbow', colors: ['#ff0000', '#ff8a00', '#ffe600', '#1aff4a', '#00e5ff', '#0040ff', '#9b30ff'] }
]

const MIN_SPEED = 600
const MIN_RANDOM = 1019311667
const MAX_RANDOM = 4294967295
const SILENCE_MS = 10000
const STORE_KEY = 'glowPicker'
const DEFAULT_COLOR = { r: 255, g: 47, b: 200, a: 255 }

const $ = id => document.getElementById(id)
const el = {
  live: $('live'), swatch: $('swatch'), hex: $('hex'), value: $('value'), status: $('status'),
  presets: $('presets'), r: $('r'), g: $('g'), b: $('b'), a: $('a'),
  rOut: $('rOut'), gOut: $('gOut'), bOut: $('bOut'), aOut: $('aOut'),
  speed: $('speed'), stop: $('stop'), swaps: $('swaps'), modes: [...document.querySelectorAll('[data-mode]')]
}

let jam = null
let timer = null
let mode = null
let cycleIndex = 0
let activeSwap = null
let recent = []
let lastConfirmed = 0
let warned = false
const saved = load()

function load () {
  const fallback = { color: DEFAULT_COLOR, cycle: ['#ff2fc8', '#ff00ff', '#9b30ff'], speed: 1000 }
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY)) || {}
    return {
      color: data.color || fallback.color,
      cycle: Array.isArray(data.cycle) ? data.cycle : fallback.cycle,
      speed: Math.max(MIN_SPEED, Number(data.speed) || fallback.speed)
    }
  } catch (_) {
    return fallback
  }
}

function save () {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)) } catch (_) {}
}

function hexToRgb (hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHex ({ r, g, b }) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

function toGlowValue ({ r, g, b, a }) {
  return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0
}

function randomValue () {
  return MIN_RANDOM + Math.floor(Math.random() * (MAX_RANDOM - MIN_RANDOM + 1))
}

function current () {
  return { r: +el.r.value, g: +el.g.value, b: +el.b.value, a: +el.a.value }
}

function render () {
  const c = current()
  const hex = rgbToHex(c)
  const alpha = (c.a / 255).toFixed(2)
  el.swatch.style.background = hex
  el.swatch.style.boxShadow = `0 0 ${6 + c.a / 12}px ${2 + c.a / 40}px rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`
  el.swatch.classList.toggle('random', mode === 'random')
  el.rOut.textContent = c.r
  el.gOut.textContent = c.g
  el.bOut.textContent = c.b
  el.aOut.textContent = c.a
  if (document.activeElement !== el.hex) el.hex.value = hex
  el.hex.classList.remove('bad')
  el.value.textContent = `Value: ${toGlowValue(c)}`
  saved.color = c
  save()
}

function setColor ({ r, g, b, a }) {
  el.r.value = r
  el.g.value = g
  el.b.value = b
  if (a !== undefined) el.a.value = a
  render()
}

function renderPresets () {
  el.presets.innerHTML = ''
  for (const p of PRESETS) {
    const div = document.createElement('div')
    div.className = 'preset' + (saved.cycle.includes(p.hex) ? ' cycle' : '')
    div.style.background = p.hex
    div.style.boxShadow = p.hex === '#000000' ? 'inset 0 0 0 1px rgba(255,255,255,0.2)' : ''
    div.title = p.name
    div.addEventListener('click', () => setColor(hexToRgb(p.hex)))
    div.addEventListener('contextmenu', e => {
      e.preventDefault()
      saved.cycle = saved.cycle.includes(p.hex)
        ? saved.cycle.filter(h => h !== p.hex)
        : [...saved.cycle, p.hex]
      save()
      renderPresets()
    })
    el.presets.appendChild(div)
  }
}

function swapChipStyle (colors) {
  const step = 360 / colors.length
  return `conic-gradient(${colors.map((c, i) => `${c} ${i * step}deg ${(i + 1) * step}deg`).join(', ')})`
}

function renderSwaps () {
  el.swaps.innerHTML = ''
  SWAPS.forEach((swap, index) => {
    const button = document.createElement('button')
    button.className = 'swap' + (mode === 'swap' && activeSwap === index ? ' active' : '')
    button.title = swap.colors.join(' / ')
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.style.background = swapChipStyle(swap.colors)
    const label = document.createElement('span')
    label.textContent = swap.name
    button.append(chip, label)
    button.addEventListener('click', () => {
      if (mode === 'swap' && activeSwap === index) return stop()
      activeSwap = index
      cycleIndex = 0
      start('swap')
    })
    el.swaps.appendChild(button)
  })
}

function setStatus (text, kind = '') {
  el.status.textContent = text
  el.status.className = kind
}

function renderMode () {
  el.modes.forEach(b => b.classList.toggle('active', b.dataset.mode === mode))
  el.live.classList.toggle('live', mode !== null)
  renderSwaps()
  render()
}

async function send (value) {
  if (!jam) return setStatus('Not connected to Jam', 'warn')
  const room = await jam.dispatch.getState('room')
  if (!room) return setStatus('Join a room first', 'warn')
  jam.dispatch.sendRemoteMessage(`<msg t="sys"><body action="pubMsg" r="${room}"><txt><![CDATA[${value}%8]]></txt></body></msg>`)
  recent.push(value)
  if (recent.length > 20) recent.shift()

  if (mode && mode !== 'once' && !warned && Date.now() - lastConfirmed > SILENCE_MS) {
    warned = true
    setStatus('Server stopped confirming. Try a slower speed.', 'warn')
  }
}

function nextValue () {
  if (mode === 'random') return randomValue()
  if (mode === 'swap') {
    const colors = SWAPS[activeSwap] ? SWAPS[activeSwap].colors : []
    if (!colors.length) return null
    const rgb = hexToRgb(colors[cycleIndex % colors.length])
    cycleIndex++
    if (rgb) setColor({ ...rgb })
    return rgb ? toGlowValue({ ...rgb, a: +el.a.value }) : null
  }
  if (mode === 'cycle') {
    const rgb = hexToRgb(saved.cycle[cycleIndex % saved.cycle.length])
    cycleIndex++
    return rgb ? toGlowValue({ ...rgb, a: +el.a.value }) : null
  }
  return toGlowValue(current())
}

function modeLabel () {
  if (mode === 'swap' && SWAPS[activeSwap]) return SWAPS[activeSwap].name
  return mode ? mode[0].toUpperCase() + mode.slice(1) : ''
}

function stop () {
  if (timer) clearInterval(timer)
  timer = null
  mode = null
  activeSwap = null
  renderMode()
  setStatus('Off')
}

function start (newMode) {
  if (timer) clearInterval(timer)
  timer = null

  if (newMode === 'cycle' && !saved.cycle.length) {
    return setStatus('Right-click presets to add them to Cycle', 'warn')
  }

  mode = newMode
  recent = []
  warned = false
  lastConfirmed = Date.now()
  renderMode()

  const speed = Math.max(MIN_SPEED, Number(el.speed.value) || 1000)
  el.speed.value = speed
  saved.speed = speed
  save()

  const tick = () => {
    const value = nextValue()
    if (value !== null) send(value)
  }

  tick()
  if (newMode === 'once') {
    mode = null
    renderMode()
    setStatus('Sent, waiting for server...')
    return
  }
  timer = setInterval(tick, speed)
  setStatus(`${modeLabel()} on, every ${speed}ms`)
}

function onIncoming ({ message }) {
  const raw = typeof message.toMessage === 'function' ? message.toMessage() : String(message)
  const m = /%xt%uc%-?\d+%\d+%(-?\d+)%8%/.exec(raw)
  if (!m || !recent.includes(Number(m[1]) >>> 0)) return
  lastConfirmed = Date.now()
  if (el.status.className !== 'ok') {
    warned = false
    setStatus(mode ? `${modeLabel()} on, confirmed by server` : 'Confirmed by server', 'ok')
  }
}

function waitForJam () {
  return new Promise(resolve => {
    if (window.jam && window.jam.dispatch) return resolve(window.jam)
    const t = setInterval(() => {
      if (window.jam && window.jam.dispatch) { clearInterval(t); resolve(window.jam) }
    }, 100)
  })
}

;['r', 'g', 'b', 'a'].forEach(k => el[k].addEventListener('input', render))

el.hex.addEventListener('input', () => {
  const rgb = hexToRgb(el.hex.value)
  if (rgb) setColor(rgb)
  else el.hex.classList.add('bad')
})

el.modes.forEach(b => b.addEventListener('click', () => {
  if (mode === b.dataset.mode) return stop()
  start(b.dataset.mode)
}))

el.speed.addEventListener('change', () => {
  if (mode) start(mode)
})

el.stop.addEventListener('click', stop)

el.speed.value = saved.speed
setColor(saved.color)
renderPresets()
renderMode()

;(async () => {
  jam = await waitForJam()
  jam.dispatch.onMessage({ type: 'aj', message: 'uc', callback: onIncoming })
  window.addEventListener('beforeunload', () => {
    if (timer) clearInterval(timer)
    try {
      const list = jam.dispatch.hooks.aj.get('uc')
      const index = list ? list.indexOf(onIncoming) : -1
      if (index !== -1) list.splice(index, 1)
    } catch (_) {}
  })
})()