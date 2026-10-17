'use strict'

const fs = require('fs')
const path = require('path')

const TYPES = ['ui', 'game']

/**
 * Reads and checks a plugin folder's plugin.json.
 *
 * Plugins written for Jam Reborn load unchanged. When `type` or `main` is
 * missing, JR works it out: index.html means a window plugin, index.js a
 * background plugin.
 *
 * @returns {{ok: true, manifest: object} | {ok: false, errors: string[]}}
 */
function readManifest (dir) {
  const file = path.join(dir, 'plugin.json')
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    return { ok: false, errors: [error.code === 'ENOENT' ? 'plugin.json is missing' : `plugin.json isn't valid JSON (${error.message})`] }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['plugin.json must be an object'] }

  const errors = []
  const str = (key, { required = false, max = 200 } = {}) => {
    const v = raw[key]
    if (v === undefined || v === null || v === '') {
      if (required) errors.push(`"${key}" is required`)
      return undefined
    }
    if (typeof v !== 'string') { errors.push(`"${key}" must be text`); return undefined }
    if (v.length > max) { errors.push(`"${key}" is too long (max ${max})`); return undefined }
    return v.trim()
  }

  const name = str('name', { required: true, max: 60 })
  const description = str('description', { max: 300 }) || ''
  const author = str('author', { max: 60 }) || ''
  const category = str('category', { max: 30 }) || 'Other'
  const icon = str('icon', { max: 40 }) || null
  const game = str('game', { max: 60 }) || '*'
  let type = str('type', { max: 10 })
  let main = str('main', { max: 200 })

  const has = (f) => fs.existsSync(path.join(dir, f))
  if (!type) {
    if (main) type = /\.html?$/i.test(main) ? 'ui' : 'game'
    else type = has('index.html') && !has('index.js') ? 'ui' : 'game'
  }
  if (type && !TYPES.includes(type)) errors.push(`"type" must be "ui" or "game"`)
  if (!main) main = type === 'ui' ? 'index.html' : 'index.js'

  if (main) {
    const resolved = path.resolve(dir, main)
    if (!isInside(dir, resolved)) errors.push('"main" must point inside the plugin folder')
    else if (!fs.existsSync(resolved)) errors.push(`"main" file ${main} is missing`)
  }

  let dependencies = {}
  if (raw.dependencies !== undefined) {
    if (!raw.dependencies || typeof raw.dependencies !== 'object' || Array.isArray(raw.dependencies)) {
      errors.push('"dependencies" must be an object of package: version')
    } else {
      dependencies = { ...raw.dependencies }
    }
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    manifest: { name, description, author, category, icon, game, type, main, dependencies }
  }
}

function isInside (dir, file) {
  const rel = path.relative(path.resolve(dir), file)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

module.exports = { readManifest, isInside }
