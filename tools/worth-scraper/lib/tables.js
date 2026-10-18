/**
 * Reads worth tables out of one wiki page's HTML.
 *
 * The wiki uses two layouts:
 *  - Column layout (e.g. Headdress, Rare Long Spiked Collar): the header row
 *    names each color/variant, one row holds a picture per column, and the
 *    remaining rows hold that column's values (and sometimes a grade row
 *    like Bad / Decent / Good / Best).
 *  - Row layout (e.g. Alpha Set, Clothing Betas): one row per item, with
 *    columns such as Item / Picture / Redeemed from / Worth.
 */
const { parse, findAll, byTag, text, imageOf } = require('./html')
const { parseOffers } = require('./values')

const GRADES = new Set(['bad', 'decent', 'good', 'great', 'best', 'okay', 'ok', 'low', 'mid', 'high', 'rare', 'common', 'uncommon'])
const VALUE_HEADER = /worth|value|trades?\s*for|price/i
const NAME_HEADER = /^(item|name|items?\s*name|clothing|den item|pet|accessory)$/i
const SKIP_HEADER = /^(image|picture|pic|photo|icon)$/i

/** Expands a <table> into a grid of cells, honouring rowspan/colspan. */
function grid (table) {
  const rows = findAll(table, byTag('tr')).filter((tr) => closestTable(tr) === table)
  const out = []
  rows.forEach((tr, r) => {
    out[r] = out[r] || []
    let c = 0
    for (const cell of tr.children.filter((n) => n.tag === 'td' || n.tag === 'th')) {
      while (out[r][c]) c++
      const rs = Math.max(1, parseInt(cell.attrs.rowspan, 10) || 1)
      const cs = Math.max(1, parseInt(cell.attrs.colspan, 10) || 1)
      const info = { node: cell, header: cell.tag === 'th', text: text(cell), image: imageOf(cell), span: cs }
      for (let i = 0; i < rs; i++) {
        out[r + i] = out[r + i] || []
        for (let j = 0; j < cs; j++) out[r + i][c + j] = info
      }
      c += cs
    }
  })
  return out.map((row) => row || [])
}

function closestTable (n) {
  for (let p = n.parent; p; p = p.parent) if (p.tag === 'table') return p
  return null
}

const isGradeRow = (cells) => cells.length > 1 && cells.every((c) => c && c.text && GRADES.has(c.text.toLowerCase()))
const imageShare = (cells) => cells.filter((c) => c && c.image).length / Math.max(1, cells.length)

/** Column layout: one item per column. */
function readColumns (g, ctx) {
  const header = g[0]
  const imageRowIdx = g.findIndex((row, i) => i > 0 && imageShare(row) >= 0.5)
  const width = Math.max(...g.map((r) => r.length))
  const items = []
  // A first column that only labels rows ("Worth", "Grade") is not an item.
  const labelCol = g.slice(1).every((row) => row[0] && row[0].header && !row[0].image) ? 0 : -1
  for (let c = 0; c < width; c++) {
    if (c === labelCol) continue
    const head = header[c]
    if (c > 0 && header[c - 1] === head) continue // colspan duplicate
    const image = imageRowIdx >= 0 && g[imageRowIdx][c] ? g[imageRowIdx][c].image : (head && head.image)
    const variant = head && head.text ? head.text : null
    let grade = null
    const values = []
    g.forEach((row, r) => {
      if (r === 0 || r === imageRowIdx) return
      const cell = row[c]
      if (!cell || !cell.text) return
      if (isGradeRow(row.filter((x, i) => i !== labelCol))) { grade = cell.text; return }
      const label = labelCol === 0 && row[0] ? row[0].text : null
      values.push({ label, text: cell.text })
    })
    if (!values.length && !image) continue
    items.push(makeItem(ctx, {
      name: ctx.title,
      variant,
      image,
      grade,
      raw: values.map((v) => (v.label ? v.label + ': ' : '') + v.text).join('\n'),
      offers: values.flatMap((v) => parseOffers(v.text))
    }))
  }
  return items
}

/** Row layout: one item per row, columns named by the header row. */
function readRows (g, ctx) {
  const header = g[0].map((c) => (c ? c.text : ''))
  const valueCols = header.map((h, i) => (VALUE_HEADER.test(h) ? i : -1)).filter((i) => i >= 0)
  let nameCol = header.findIndex((h) => NAME_HEADER.test(h))
  if (nameCol < 0) nameCol = header.findIndex((h) => h && !SKIP_HEADER.test(h) && !VALUE_HEADER.test(h))
  if (nameCol < 0) nameCol = 0
  const worthCols = valueCols.length ? valueCols : [header.length - 1]
  const items = []
  for (let r = 1; r < g.length; r++) {
    const row = g[r]
    if (!row.length) continue
    const nameCell = row[nameCol]
    const name = nameCell && nameCell.text ? nameCell.text.split('\n')[0] : null
    if (!name) continue
    const fields = {}
    header.forEach((h, i) => {
      if (!h || i === nameCol || worthCols.includes(i) || SKIP_HEADER.test(h)) return
      if (row[i] && row[i].text) fields[h] = row[i].text
    })
    const worthText = worthCols.map((i) => (row[i] ? row[i].text : '')).filter(Boolean).join('\n')
    if (!worthText) continue
    const image = row.map((c) => c && c.image).find(Boolean) || null
    items.push(makeItem(ctx, {
      name,
      variant: null,
      image,
      grade: null,
      fields,
      raw: worthText,
      offers: parseOffers(worthText)
    }))
  }
  return items
}

function makeItem (ctx, data) {
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const id = [slug(ctx.title), slug(data.name !== ctx.title ? data.name : ''), slug(data.variant)].filter(Boolean).join('/')
  return {
    id,
    page: ctx.title,
    url: ctx.url,
    section: ctx.section || null,
    name: data.name,
    variant: data.variant || null,
    image: data.image ? data.image.url : null,
    imageName: data.image ? data.image.name : null,
    grade: data.grade || null,
    offers: data.offers,
    raw: data.raw,
    fields: data.fields && Object.keys(data.fields).length ? data.fields : undefined,
    lastUpdated: ctx.lastUpdated,
    editedAt: ctx.editedAt || null
  }
}

/** Finds "Last Updated 9/16/20" style dates; returns ISO date or null. */
function lastUpdatedOf (pageText) {
  const m = pageText.match(/last\s+updated:?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i)
  if (!m) return null
  let y = Number(m[3])
  if (y < 100) y += 2000
  const pad = (n) => String(n).padStart(2, '0')
  return `${y}-${pad(m[1])}-${pad(m[2])}`
}

/**
 * Reads every worth table on a page.
 * @param {string} html - The page HTML from action=parse.
 * @param {{title:string, url:string, editedAt?:string}} meta
 * @returns {{items:Array, warnings:Array<string>, lastUpdated:string|null}}
 */
function readPage (html, meta) {
  const root = parse(html)
  const pageText = text(root)
  const lastUpdated = lastUpdatedOf(pageText)
  const items = []
  const warnings = []
  let section = null

  const visit = (node) => {
    for (const n of node.children || []) {
      if (!n.tag) continue
      if (/^h[2-4]$/.test(n.tag)) { section = text(n) || section; continue }
      if (n.tag === 'table') {
        const g = grid(n)
        if (g.length < 2) continue
        const ctx = { title: meta.title, url: meta.url, editedAt: meta.editedAt, lastUpdated, section }
        const columnLayout = g.some((row, i) => i > 0 && imageShare(row) >= 0.5 && row.length >= 2) &&
          !g[0].some((c) => c && VALUE_HEADER.test(c.text))
        const found = columnLayout ? readColumns(g, ctx) : readRows(g, ctx)
        if (!found.length) warnings.push(`table${section ? ` in "${section}"` : ''} had no readable values`)
        items.push(...found)
        continue
      }
      visit(n)
    }
  }
  visit(root)

  // Make ids unique when a page repeats a name.
  const seen = new Map()
  for (const it of items) {
    const n = (seen.get(it.id) || 0) + 1
    seen.set(it.id, n)
    if (n > 1) it.id += `~${n}`
  }
  for (const it of items) {
    if (!it.offers.length || it.offers.every((o) => o.min == null && !o.bundle)) warnings.push(`"${it.name}${it.variant ? ' / ' + it.variant : ''}": value is text only`)
  }
  return { items, warnings, lastUpdated }
}

module.exports = { readPage, grid, lastUpdatedOf }
