/**
 * A tiny, dependency-free HTML reader. It is only meant for the HTML that
 * MediaWiki's parse API returns (tables, images, headings), not for arbitrary
 * web pages. Builds a simple tree of { tag, attrs, children, parent } nodes;
 * text is stored as { text } nodes.
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const RAW_TEXT = new Set(['script', 'style'])

// Opening one of these closes an open element of the listed kinds first.
const AUTO_CLOSE = {
  td: ['td', 'th'],
  th: ['td', 'th'],
  tr: ['tr', 'td', 'th'],
  li: ['li'],
  p: ['p'],
  thead: ['tbody', 'thead', 'tfoot', 'tr', 'td', 'th'],
  tbody: ['tbody', 'thead', 'tfoot', 'tr', 'td', 'th'],
  tfoot: ['tbody', 'thead', 'tfoot', 'tr', 'td', 'th']
}
// Auto-closing never reaches past one of these.
const SCOPE = new Set(['table', 'div', 'body', 'html'])

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', times: '×', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : m
  }
  const v = ENTITIES[e.toLowerCase()]
  return v === undefined ? m : v
})

const parseAttrs = (src) => {
  const attrs = {}
  const re = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let m
  while ((m = re.exec(src))) {
    attrs[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? '')
  }
  return attrs
}

/**
 * Parses an HTML string into a tree.
 * @param {string} html
 * @returns {{tag:string, attrs:Object, children:Array}}
 */
function parse (html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null }
  const stack = [root]
  const top = () => stack[stack.length - 1]
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g
  let m

  const closeTo = (tag) => {
    for (let i = stack.length - 1; i > 0; i--) {
      if (stack[i].tag === tag) { stack.length = i; return true }
      if (SCOPE.has(stack[i].tag) && stack[i].tag !== tag) return false
    }
    return false
  }

  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue
    if (m[4] !== undefined || m[0] === '<') {
      const text = decode(m[4] ?? '<')
      top().children.push({ text, parent: top() })
      continue
    }
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    if (closing) {
      closeTo(tag)
      continue
    }
    if (AUTO_CLOSE[tag]) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (SCOPE.has(stack[i].tag)) break
        if (AUTO_CLOSE[tag].includes(stack[i].tag)) { stack.length = i; break }
      }
    }
    const node = { tag, attrs: parseAttrs(m[3] || ''), children: [], parent: top() }
    top().children.push(node)
    const selfClosing = /\/\s*$/.test(m[3] || '')
    if (RAW_TEXT.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex)
      re.lastIndex = end === -1 ? html.length : html.indexOf('>', end) + 1
      continue
    }
    if (!VOID.has(tag) && !selfClosing) stack.push(node)
  }
  return root
}

/** All descendant elements (document order) matching a predicate. */
function findAll (node, pred, out = []) {
  for (const c of node.children || []) {
    if (c.tag) {
      if (pred(c)) out.push(c)
      findAll(c, pred, out)
    }
  }
  return out
}

const byTag = (tag) => (n) => n.tag === tag
const hasClass = (n, cls) => (` ${n.attrs.class || ''} `).includes(` ${cls} `)

/**
 * Visible text of a node. <br> and block ends become newlines so "A<br>OR<br>B"
 * keeps its line structure. Hidden helper text MediaWiki adds is skipped.
 */
function text (node) {
  let out = ''
  const walk = (n) => {
    if (n.text !== undefined) { out += n.text; return }
    if (n.tag === 'br') { out += '\n'; return }
    if (n.attrs && (hasClass(n, 'mw-editsection') || hasClass(n, 'reference') || n.attrs.style === 'display:none' || n.attrs.style === 'display: none')) return
    const block = ['p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(n.tag)
    if (block && out && !out.endsWith('\n')) out += '\n'
    for (const c of n.children || []) walk(c)
    if (block && !out.endsWith('\n')) out += '\n'
  }
  walk(node)
  return out
    .replace(/[ \t\r\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/**
 * The best image URL inside a node, or null. Handles Fandom's lazy-loaded
 * images (data-src) and strips the thumbnail-size part of the URL.
 */
function imageOf (node) {
  const imgs = findAll(node, byTag('img'))
  for (const img of imgs) {
    let src = img.attrs['data-src'] || img.attrs.src || ''
    if (!src || src.startsWith('data:')) {
      const a = img.parent && img.parent.tag === 'a' ? img.parent : null
      src = a && /\.(png|jpe?g|gif|webp)/i.test(a.attrs.href || '') ? a.attrs.href : ''
    }
    if (!src || src.startsWith('data:')) continue
    if (src.startsWith('//')) src = 'https:' + src
    src = src.replace(/\/scale-to-width-down\/\d+/, '').replace(/\/smart\/width\/\d+\/height\/\d+/, '')
    return {
      url: src,
      name: img.attrs['data-image-name'] || img.attrs['data-image-key'] || img.attrs.alt || null
    }
  }
  return null
}

module.exports = { parse, findAll, byTag, hasClass, text, imageOf, decode }
