'use strict'

/**
 * Just enough of a web page for a plugin window script to run without a
 * window, so its in-game version can reuse the same, tested code. Elements
 * keep their values, text, children and listeners; nothing is drawn.
 */

class FakeElement {
  constructor (tag, id) {
    this.tagName = String(tag || 'div').toUpperCase()
    this.id = id || ''
    this.children = []
    this.parentNode = null
    this.listeners = {}
    this.style = {}
    this.dataset = {}
    this.attributes = {}
    this.value = ''
    this.checked = false
    this.disabled = false
    this.className = ''
    this.title = ''
    this.type = ''
    this.scrollTop = 0
    this.scrollHeight = 0
    this._text = ''
    const self = this
    this.classList = {
      add: (...c) => { const s = new Set(self.className.split(/\s+/).filter(Boolean)); c.forEach(x => s.add(x)); self.className = [...s].join(' ') },
      remove: (...c) => { self.className = self.className.split(/\s+/).filter(x => x && !c.includes(x)).join(' ') },
      toggle: (c, on) => { const has = self.classList.contains(c); const want = on === undefined ? !has : !!on; if (want && !has) self.classList.add(c); if (!want && has) self.classList.remove(c); return want },
      contains: (c) => self.className.split(/\s+/).includes(c)
    }
  }

  get textContent () { return this._text + this.children.map(c => c.textContent).join('') }
  set textContent (t) { this._text = String(t == null ? '' : t); this.children = [] }
  get innerText () { return this.textContent }
  set innerText (t) { this.textContent = t }
  get innerHTML () { return this._text }
  set innerHTML (t) { this._text = String(t == null ? '' : t).replace(/<[^>]*>/g, ''); this.children = [] }
  get firstChild () { return this.children[0] || null }
  get lastChild () { return this.children[this.children.length - 1] || null }
  get childElementCount () { return this.children.length }
  get options () { return this.children }

  appendChild (c) { if (c && c.parentNode) c.parentNode.removeChild(c); if (c) { c.parentNode = this; this.children.push(c) } return c }
  append (...cs) { for (const c of cs) this.appendChild(typeof c === 'string' ? Object.assign(new FakeElement('#text'), { _text: c }) : c) }
  prepend (...cs) { for (const c of cs.reverse()) { const e = typeof c === 'string' ? Object.assign(new FakeElement('#text'), { _text: c }) : c; e.parentNode = this; this.children.unshift(e) } }
  insertBefore (c, ref) { const i = this.children.indexOf(ref); c.parentNode = this; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c }
  removeChild (c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); if (c) c.parentNode = null; return c }
  remove () { if (this.parentNode) this.parentNode.removeChild(this) }
  replaceChildren (...cs) { this.children = []; this.append(...cs) }
  setAttribute (k, v) { this.attributes[k] = String(v) }
  getAttribute (k) { return this.attributes[k] == null ? null : this.attributes[k] }
  removeAttribute (k) { delete this.attributes[k] }
  addEventListener (type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn) }
  removeEventListener (type, fn) { const l = this.listeners[type] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1) }
  dispatch (type, extra = {}) {
    const event = Object.assign({ type, target: this, currentTarget: this, preventDefault () {}, stopPropagation () {} }, extra)
    for (const fn of (this.listeners[type] || []).slice()) fn.call(this, event)
    const on = this['on' + type]
    if (typeof on === 'function') on.call(this, event)
  }

  click () { this.dispatch('click') }
  focus () {}
  blur () {}
  select () {}
  scrollIntoView () {}
  closest () { return null }
  matches () { return false }
  querySelector () { return null }
  querySelectorAll () { return [] }
  getBoundingClientRect () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } }
}

function createFakePage () {
  const byId = new Map()
  const document = {
    body: new FakeElement('body'),
    getElementById (id) { if (!byId.has(id)) byId.set(id, new FakeElement('div', id)); return byId.get(id) },
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => Object.assign(new FakeElement('#text'), { _text: String(text) }),
    createDocumentFragment: () => new FakeElement('#fragment'),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener () {},
    removeEventListener () {}
  }
  return { document, element: (id) => document.getElementById(id) }
}

/** localStorage kept in a plugin's JR storage. */
function fakeLocalStorage (store, key = 'localStorage') {
  const all = () => store.get(key, {}) || {}
  return {
    getItem: (k) => { const v = all()[k]; return v == null ? null : String(v) },
    setItem: (k, v) => { const a = all(); a[k] = String(v); store.set(key, a) },
    removeItem: (k) => { const a = all(); delete a[k]; store.set(key, a) },
    clear: () => store.set(key, {})
  }
}

module.exports = { FakeElement, createFakePage, fakeLocalStorage }
