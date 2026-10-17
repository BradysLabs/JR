const STORE_KEY = 'masterpieceStudio'
const $ = id => document.getElementById(id)

const view = {
  img: null,
  name: '',
  fit: 'fill',
  zoom: 1,
  offsetX: 0,
  offsetY: 0
}

let opened = null
let sizeTimer = null

function load () {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {} } catch (_) { return {} }
}

function save (patch) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...load(), ...patch })) } catch (_) {}
}

function toast (text) {
  const t = $('toast')
  t.textContent = text
  t.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => t.classList.remove('show'), 1600)
}

function setHint (el, text, kind = '') {
  el.textContent = text
  el.className = 'hint' + (kind ? ' ' + kind : '')
}

function formatBytes (n) {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(2)} MB`
}

function findUuid (value, depth = 0) {
  if (!value || depth > 5) return null
  if (typeof value === 'string') return UUID_RE.test(value) ? value : null
  if (typeof value !== 'object') return null
  for (const v of Object.values(value)) {
    const found = findUuid(v, depth + 1)
    if (found) return found
  }
  return null
}

async function detectUuid () {
  try {
    const player = window.jam && window.jam.dispatch && await window.jam.dispatch.getState('player')
    return findUuid(player)
  } catch (_) {
    return null
  }
}

function geometry () {
  const { img, fit, zoom, offsetX, offsetY } = view
  const W = WIDTH
  const H = HEIGHT
  if (fit === 'stretch') return { x: 0, y: 0, w: W, h: H }
  const scale = (fit === 'fill' ? Math.max(W / img.width, H / img.height) : Math.min(W / img.width, H / img.height)) * zoom
  const w = img.width * scale
  const h = img.height * scale
  let x = (W - w) / 2 + offsetX
  let y = (H - h) / 2 + offsetY
  if (fit === 'fill') {
    x = Math.min(0, Math.max(W - w, x))
    y = Math.min(0, Math.max(H - h, y))
  }
  return { x, y, w, h }
}

function render () {
  const canvas = $('canvas')
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, WIDTH, HEIGHT)
  $('drop').classList.toggle('hidden', !!view.img)
  $('frame').classList.toggle('grab', !!view.img && view.fit !== 'stretch')
  $('zoomField').classList.toggle('hidden', view.fit === 'stretch')
  $('bgField').classList.toggle('hidden', view.fit !== 'fit')
  $('save').disabled = !view.img
  $('clearImg').disabled = !view.img
  $('pickImg').textContent = view.img ? 'Replace image…' : 'Choose image…'
  $('swapHint').style.display = view.img ? '' : 'none'
  if (!view.img) {
    $('outInfo').textContent = ''
    return
  }

  ctx.fillStyle = view.fit === 'fit' ? $('bg').value : '#ffffff'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  ctx.imageSmoothingQuality = 'high'
  const g = geometry()
  if (view.fit === 'fill') {
    const W = WIDTH
    const H = HEIGHT
    view.offsetX = g.x - (W - g.w) / 2
    view.offsetY = g.y - (H - g.h) / 2
  }
  ctx.drawImage(view.img, g.x, g.y, g.w, g.h)

  clearTimeout(sizeTimer)
  sizeTimer = setTimeout(() => {
    canvas.toBlob(b => { if (b) $('outInfo').textContent = `760 × 460 JPEG · ${formatBytes(b.size)}` }, 'image/jpeg', quality())
  }, 150)
}

function quality () {
  return Number($('quality').value) / 100
}

function loadImageFile (file) {
  if (!file || !/^image\//.test(file.type)) return toast('That is not an image.')
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => {
    view.img = img
    view.name = file.name || 'pasted image'
    resetView()
    $('srcInfo').textContent = `${view.name} · ${img.width} × ${img.height}`
    if (img.width < WIDTH || img.height < HEIGHT) $('srcInfo').textContent += ' · smaller than 760 × 460, may look blurry'
  }
  img.onerror = () => toast('Could not read that image.')
  img.src = url
}

function resetView () {
  view.zoom = 1
  view.offsetX = 0
  view.offsetY = 0
  $('zoom').value = 100
  $('zoomOut').textContent = '100%'
  render()
}

function download (name, bytes, mime) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes], { type: mime }))
  a.download = name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
}

function checkUuid (input, hint) {
  const v = input.value.trim()
  const ok = UUID_RE.test(v)
  input.classList.toggle('bad', !!v && !ok)
  if (hint) {
    if (!v) setHint(hint, 'The file is locked to your account\'s uuid.')
    else if (!ok) setHint(hint, 'That doesn\'t look like a uuid.', 'err')
    else setHint(hint, 'uuid looks good.', 'ok')
  }
  return ok ? v : null
}

async function saveMasterpiece () {
  const uuid = checkUuid($('uuid'), $('uuidHint'))
  if (!uuid) return toast('Enter your player uuid first.')
  const type = $('type').value
  const blob = await new Promise(resolve => $('canvas').toBlob(resolve, 'image/jpeg', quality()))
  const jpeg = NodeBuffer.from(await blob.arrayBuffer())
  try {
    const file = encode(jpeg, uuid, type)
    const check = decode(file, uuid)
    if (!check.image.equals(jpeg)) throw new Error('Self-check failed.')
    const ext = TYPES[type].ext
    download(`masterpiece-${Date.now()}.${ext}`, file, 'application/octet-stream')
    toast(`Saved .${ext} (${formatBytes(file.length)})`)
  } catch (err) {
    toast(err.message)
  }
}

function showOpened () {
  const canvas = $('openCanvas')
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, WIDTH, HEIGHT)
  $('openDrop').classList.toggle('hidden', !!opened)
  $('openSave').disabled = !opened
  $('openEdit').disabled = !opened
  if (!opened) return
  ctx.drawImage(opened.img, 0, 0, WIDTH, HEIGHT)
}

async function openFile (file) {
  if (!file) return
  const uuid = checkUuid($('openUuid'))
  if (!uuid) return toast('Enter the owner uuid first.')
  try {
    const bytes = NodeBuffer.from(await file.arrayBuffer())
    const { image, type } = decode(bytes, uuid)
    const isPng = image[0] === 0x89 && image[1] === 0x50
    const mime = isPng ? 'image/png' : 'image/jpeg'
    const img = new Image()
    img.onload = () => {
      opened = { img, image, mime, name: file.name }
      $('openInfo').textContent = `${file.name} · ${type || 'unknown type'} · ${img.width} × ${img.height} · ${isPng ? 'PNG' : 'JPEG'} · ${formatBytes(image.length)}`
      showOpened()
    }
    img.onerror = () => toast('Unlocked, but the picture inside is damaged.')
    img.src = URL.createObjectURL(new Blob([image], { type: mime }))
  } catch (err) {
    opened = null
    showOpened()
    $('openInfo').textContent = err.message
  }
}

function setTab (tab) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab))
  $('createPage').classList.toggle('hidden', tab !== 'create')
  $('openPage').classList.toggle('hidden', tab !== 'open')
}

function bindDrop (frame, drop, onFile) {
  frame.addEventListener('dragover', e => { e.preventDefault(); frame.classList.add('over') })
  frame.addEventListener('dragleave', () => frame.classList.remove('over'))
  frame.addEventListener('drop', e => {
    e.preventDefault()
    frame.classList.remove('over')
    onFile(e.dataTransfer.files[0])
  })
}

document.addEventListener('DOMContentLoaded', async () => {
  const stored = load()
  if (stored.uuid) {
    $('uuid').value = stored.uuid
    $('openUuid').value = stored.uuid
  }
  if (stored.type) $('type').value = stored.type
  if (stored.quality) $('quality').value = stored.quality
  $('qOut').textContent = $('quality').value
  checkUuid($('uuid'), $('uuidHint'))

  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('button')
    if (b) setTab(b.dataset.tab)
  })

  $('drop').addEventListener('click', () => $('imgInput').click())
  $('pickImg').addEventListener('click', () => $('imgInput').click())
  $('clearImg').addEventListener('click', () => {
    view.img = null
    view.name = ''
    $('srcInfo').textContent = 'No image yet'
    resetView()
  })
  $('imgInput').addEventListener('change', e => { loadImageFile(e.target.files[0]); e.target.value = '' })
  bindDrop($('frame'), $('drop'), loadImageFile)
  document.addEventListener('paste', e => {
    const item = [...(e.clipboardData || {}).items || []].find(i => i.type.startsWith('image/'))
    if (item) { setTab('create'); loadImageFile(item.getAsFile()) }
  })

  $('fit').addEventListener('click', e => {
    const b = e.target.closest('button')
    if (!b) return
    view.fit = b.dataset.v
    $('fit').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b))
    resetView()
  })
  $('zoom').addEventListener('input', () => {
    view.zoom = Number($('zoom').value) / 100
    $('zoomOut').textContent = `${$('zoom').value}%`
    render()
  })
  $('bg').addEventListener('input', render)
  $('quality').addEventListener('input', () => {
    $('qOut').textContent = $('quality').value
    save({ quality: $('quality').value })
    render()
  })
  $('reset').addEventListener('click', resetView)

  const canvas = $('canvas')
  canvas.addEventListener('mousedown', e => {
    if (!view.img || view.fit === 'stretch') return
    const rect = canvas.getBoundingClientRect()
    const ratio = WIDTH / rect.width
    const start = { x: e.clientX, y: e.clientY, ox: view.offsetX, oy: view.offsetY }
    $('frame').classList.add('grabbing')
    const move = ev => {
      view.offsetX = start.ox + (ev.clientX - start.x) * ratio
      view.offsetY = start.oy + (ev.clientY - start.y) * ratio
      render()
    }
    const up = () => {
      $('frame').classList.remove('grabbing')
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  })
  canvas.addEventListener('wheel', e => {
    if (!view.img || view.fit === 'stretch') return
    e.preventDefault()
    const z = Math.max(100, Math.min(400, Number($('zoom').value) - Math.sign(e.deltaY) * 10))
    $('zoom').value = z
    $('zoom').dispatchEvent(new Event('input'))
  }, { passive: false })

  $('uuid').addEventListener('input', () => {
    const ok = checkUuid($('uuid'), $('uuidHint'))
    if (ok) save({ uuid: ok })
  })
  $('type').addEventListener('change', () => save({ type: $('type').value }))
  $('detect').addEventListener('click', async () => {
    const found = await detectUuid()
    if (!found) return setHint($('uuidHint'), 'Couldn\'t find it. Log in through JR first, or paste it in.', 'warn')
    $('uuid').value = found
    $('openUuid').value = $('openUuid').value || found
    checkUuid($('uuid'), $('uuidHint'))
    save({ uuid: found })
    toast('Found your uuid')
  })
  $('save').addEventListener('click', saveMasterpiece)

  $('openDrop').addEventListener('click', () => $('fileInput').click())
  $('openPick').addEventListener('click', () => $('fileInput').click())
  $('fileInput').addEventListener('change', e => { openFile(e.target.files[0]); e.target.value = '' })
  bindDrop($('openFrame'), $('openDrop'), openFile)
  $('openDetect').addEventListener('click', async () => {
    const found = (await detectUuid()) || checkUuid($('uuid'))
    if (found) $('openUuid').value = found
    else toast('Couldn\'t find your uuid')
  })
  $('openSave').addEventListener('click', () => {
    if (!opened) return
    const ext = opened.mime === 'image/png' ? 'png' : 'jpg'
    download(opened.name.replace(/\.[^.]+$/, '') + '.' + ext, opened.image, opened.mime)
  })
  $('openEdit').addEventListener('click', () => {
    if (!opened) return
    view.img = opened.img
    view.name = opened.name
    $('srcInfo').textContent = `${opened.name} · ${opened.img.width} × ${opened.img.height}`
    setTab('create')
    resetView()
  })

  render()

  if (!$('uuid').value) {
    const found = await detectUuid()
    if (found) {
      $('uuid').value = found
      $('openUuid').value = found
      checkUuid($('uuid'), $('uuidHint'))
      save({ uuid: found })
    }
  }
})
