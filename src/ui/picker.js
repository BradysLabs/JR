'use strict'

/* JR startup window: loading steps, Discord check, profile picker. */

const $ = (id) => document.getElementById(id)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const COLORS = ['#ededee', '#d9a441', '#7a6ad8', '#4f9e7a', '#d9705b', '#5a9fd6']
const inkFor = (hex) => (['#ededee', '#d9a441', '#ffffff'].includes(String(hex).toLowerCase()) ? '#0b0b0c' : '#ffffff')

let boot = null
let invite = ''

document.querySelectorAll('[data-win]').forEach(b => { b.onclick = () => window.jr.win(b.dataset.win) })

function show (id) {
  for (const s of ['splash', 'warn', 'gate', 'pick', 'create']) $(s).classList.toggle('hidden', s !== id)
  $(id).querySelector('.center').classList.remove('rise')
  void $(id).offsetWidth
  $(id).querySelector('.center').classList.add('rise')
  $('tbLeft').style.opacity = id === 'splash' ? 0 : 1
}

function toast (text, isError) {
  const t = document.createElement('div')
  t.className = 'toast' + (isError ? ' error' : '')
  t.textContent = text
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 4200)
}

/* -------------------------------------------------------------- splash */

const STEPS = [['Loading settings', ''], ['Checking Discord membership', ''], ['Finding your profiles', '']]
function renderSteps (current, details = {}) {
  $('steps').innerHTML = ''
  STEPS.forEach(([label], i) => {
    const el = document.createElement('div')
    el.className = 'step' + (i < current ? ' done' : i === current ? ' active' : '')
    const ic = document.createElement('div')
    ic.className = 'ic'
    ic.innerHTML = i < current
      ? '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#ededee"/><path d="M5 8.2l2 2 4-4.4" stroke="#0b0b0c" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : i === current ? '<div class="spinner" style="width:14px;height:14px"></div>' : '<div class="dot"></div>'
    const text = document.createElement('div')
    text.textContent = label
    const d = document.createElement('div')
    d.className = 'detail'
    d.textContent = i < current ? (details[i] || '') : ''
    el.append(ic, text, d)
    $('steps').appendChild(el)
  })
  $('barFill').style.width = Math.round((current / STEPS.length) * 100) + '%'
}

async function start () {
  renderSteps(0)
  requestAnimationFrame(() => { $('splashLogo').style.transform = 'scale(1)'; $('splashLogo').style.opacity = 1 })
  const details = {}
  boot = await window.jr.boot()
  invite = boot.invite
  $('tbVersion').textContent = 'v' + boot.version
  $('splashVersion').textContent = 'v' + boot.version
  await sleep(350)
  if (!boot.skipWarning) await showWarning()
  show('splash')
  renderSteps(1, details)

  let gate = boot.gate
  if (!gate.disabled) gate = await window.jr.gate.start()
  details[1] = gate.disabled ? 'off' : gate.state === 'member' ? 'member' : ''
  if (gate.state !== 'member') {
    showGate(gate)
    return
  }
  showWho(gate)
  await sleep(300)
  renderSteps(2, details)
  const list = await window.jr.profiles.list()
  details[2] = String(list.length)
  await sleep(300)
  renderSteps(3, details)
  await sleep(250)
  showProfiles(list)
}

/* ------------------------------------------------------------- warning */

function showWarning () {
  show('warn')
  return new Promise(resolve => {
    $('warnOk').onclick = async () => {
      $('warnOk').disabled = true
      try { await window.jr.acceptWarning($('warnSkip').checked) } catch (_) {}
      resolve()
    }
  })
}

/* ---------------------------------------------------------------- gate */

function showWho (gate) {
  const who = $('who')
  if (!gate.user) { who.classList.add('hidden'); return }
  who.classList.remove('hidden')
  who.innerHTML = ''
  const a = avatarEl(gate.user, 16)
  const label = document.createElement('span')
  label.textContent = `${gate.user.globalName || gate.user.username} · JR member`
  who.append(a, label)
  who.onclick = async () => {
    if (!confirmInline(who, 'Sign out of Discord?')) return
    showGate(await window.jr.gate.signOut())
  }
}

function confirmInline (el, question) { return window.confirm(question) }

function avatarEl (user, size) {
  const a = document.createElement('div')
  a.className = 'avatar-s'
  a.style.width = a.style.height = size + 'px'
  if (user.avatar) {
    const img = document.createElement('img')
    img.src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
    img.onerror = () => { img.remove(); a.textContent = (user.globalName || user.username || '?')[0].toUpperCase() }
    a.appendChild(img)
  } else {
    a.textContent = (user.globalName || user.username || '?')[0].toUpperCase()
  }
  return a
}

function showGate (info) {
  show('gate')
  const user = info.user
  $('gateUser').classList.toggle('hidden', !user)
  $('gateSwitch').classList.toggle('hidden', !user)
  if (user) {
    $('gateAvatar').replaceWith(Object.assign(avatarEl(user, 24), { id: 'gateAvatar' }))
    $('gateName').textContent = 'Signed in as ' + (user.globalName || user.username)
  }
  const actions = $('gateActions')
  actions.innerHTML = ''
  const add = (label, primary, fn) => {
    const b = document.createElement('button')
    b.className = 'btn big' + (primary ? ' primary' : '')
    b.textContent = label
    b.onclick = fn
    actions.appendChild(b)
  }
  $('gateSpin').classList.add('hidden')
  $('gateFine').classList.toggle('hidden', info.state !== 'signed-out')

  const set = (title, text, foot) => { $('gateTitle').textContent = title; $('gateText').textContent = text; $('gateFoot').textContent = foot || '' }
  if (info.state === 'signing-in') {
    set('Finish signing in in your browser', 'A Discord page opened in your web browser. Click Authorize there, then come back here.', 'Didn’t see it? Check your browser’s tabs.')
    $('gateSpin').classList.remove('hidden')
  } else if (info.state === 'checking') {
    set('Checking your membership…', 'One moment.', '')
    $('gateSpin').classList.remove('hidden')
  } else if (info.state === 'not-member') {
    const role = info.reason === 'missing_role'
    set(role ? 'You need the JR role' : 'Join the JR Discord to play',
      role ? 'You’re in the JR server but don’t have the role JR needs yet.' : 'You’re signed in, but this Discord account isn’t in the JR server. Join, then check again.',
      'Banned from the server? JR stays locked.')
    add('Join the JR Discord', true, () => window.jr.openUrl(invite))
    add('I’ve joined, check again', false, () => runGate(window.jr.gate.check))
  } else if (info.state === 'offline') {
    set('Can’t reach Discord', 'JR couldn’t confirm your membership. Check your internet and try again.', 'Short Discord outages don’t interrupt your game.')
    add('Try again', true, () => runGate(window.jr.gate.check))
  } else {
    const reason = { cancelled: 'Sign-in was cancelled.', sign_in_failed: 'Signing in didn’t work. Try again.', expired: 'Your sign-in expired. Sign in again.' }[info.reason]
    set('Sign in to use JR', (reason ? reason + ' ' : '') + 'JR is for members of the JR Discord server. Sign in with Discord once and you’re set.', 'Not a member yet? Join the JR Discord first.')
    add('Sign in with Discord', true, () => runGate(window.jr.gate.signIn))
    add('Join the JR Discord', false, () => window.jr.openUrl(invite))
  }
  $('gateSwitch').onclick = async () => showGate(await window.jr.gate.signOut())
}

async function runGate (fn) {
  try {
    const info = await fn()
    if (info.state === 'member') {
      showWho(info)
      showProfiles(await window.jr.profiles.list())
    } else {
      showGate(info)
    }
  } catch (error) {
    toast(error.message, true)
  }
}

window.jr.gate.onChange((info) => {
  if (!$('gate').classList.contains('hidden') && (info.state === 'signing-in' || info.state === 'checking')) showGate(info)
  if (info.state !== 'member' && !['signing-in', 'checking'].includes(info.state) && $('gate').classList.contains('hidden') && boot && !boot.gate.disabled) showGate(info)
})

/* ------------------------------------------------------------ profiles */

function ago (t) {
  if (!t) return 'Never played'
  const d = Math.floor((Date.now() - t) / 86400000)
  if (d <= 0) return 'Played today'
  if (d === 1) return 'Played yesterday'
  return `Played ${d} days ago`
}

function showProfiles (list) {
  show('pick')
  const cards = $('cards')
  cards.innerHTML = ''
  for (const p of list) {
    const card = document.createElement('button')
    card.className = 'card'
    card.title = p.open ? `${p.name} is open` : `Open ${p.name}`
    const av = document.createElement('div')
    av.className = 'avatar'
    av.style.background = p.color
    av.style.color = inkFor(p.color)
    av.textContent = p.name[0].toUpperCase()
    const name = document.createElement('div'); name.className = 'name'; name.textContent = p.name
    const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = ago(p.lastUsedAt)
    card.append(av, name, sub)
    if (p.open) { const o = document.createElement('div'); o.className = 'open'; o.textContent = 'OPEN'; card.appendChild(o) }
    const more = document.createElement('button')
    more.className = 'more'
    more.title = 'More'
    more.textContent = '⋯'
    more.onclick = (e) => { e.stopPropagation(); profileMenu(e, p) }
    card.appendChild(more)
    card.oncontextmenu = (e) => { e.preventDefault(); profileMenu(e, p) }
    card.onclick = () => openProfile(p, card)
    cards.appendChild(card)
  }
  const add = document.createElement('button')
  add.className = 'card new'
  add.innerHTML = '<div class="avatar" style="border:1.5px dashed #3a3a40;color:#8a8a90;font-size:28px">+</div><div class="name">New profile</div><div class="sub">Another account</div>'
  add.onclick = () => showCreate()
  cards.appendChild(add)
}

async function openProfile (p, card) {
  card.disabled = true
  const spin = document.createElement('div')
  spin.className = 'spinner'
  spin.style.marginTop = '12px'
  card.appendChild(spin)
  try {
    await window.jr.profiles.open(p.id)
  } catch (error) {
    toast(error.message, true)
    spin.remove()
    card.disabled = false
  }
}

function profileMenu (e, p) {
  document.querySelectorAll('.menu').forEach(m => m.remove())
  const menu = document.createElement('div')
  menu.className = 'menu'
  menu.style.left = Math.min(e.clientX, innerWidth - 180) + 'px'
  menu.style.top = Math.min(e.clientY, innerHeight - 100) + 'px'
  const item = (label, fn, danger) => {
    const b = document.createElement('button')
    b.textContent = label
    if (danger) b.className = 'danger'
    b.onclick = () => { menu.remove(); fn() }
    menu.appendChild(b)
  }
  item('Rename', () => showCreate(p))
  item('Delete profile…', async () => {
    if (!window.confirm(`Delete "${p.name}"? Its settings and plugin data will be removed from this computer.`)) return
    try { await window.jr.profiles.remove(p.id); showProfiles(await window.jr.profiles.list()) } catch (error) { toast(error.message, true) }
  }, true)
  document.body.appendChild(menu)
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0)
}

let editing = null
let color = COLORS[0]
function showCreate (profile = null) {
  editing = profile
  show('create')
  $('createTitle').textContent = profile ? 'Rename profile' : 'New profile'
  $('createSave').textContent = profile ? 'Save' : 'Create profile'
  $('createName').value = profile ? profile.name : ''
  $('createError').textContent = ''
  color = profile ? profile.color : COLORS[Math.floor(Math.random() * COLORS.length)]
  renderColors()
  $('colors').parentElement.querySelectorAll('label')[1].classList.toggle('hidden', !!profile)
  $('colors').classList.toggle('hidden', !!profile)
  setTimeout(() => $('createName').focus(), 50)
}
function renderColors () {
  $('colors').innerHTML = ''
  for (const c of COLORS) {
    const b = document.createElement('button')
    b.style.background = c
    b.className = c === color ? 'on' : ''
    b.title = c
    b.onclick = () => { color = c; renderColors() }
    $('colors').appendChild(b)
  }
}
$('createCancel').onclick = async () => showProfiles(await window.jr.profiles.list())
$('createName').onkeydown = (e) => { if (e.key === 'Enter') $('createSave').click() }
$('createSave').onclick = async () => {
  try {
    if (editing) await window.jr.profiles.rename(editing.id, $('createName').value)
    else await window.jr.profiles.create($('createName').value, color)
    showProfiles(await window.jr.profiles.list())
  } catch (error) {
    $('createError').textContent = error.message
  }
}

start().catch(error => toast(error.message, true))
