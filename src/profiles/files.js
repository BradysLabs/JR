'use strict'

const fs = require('fs')
const path = require('path')

/** Reads a JSON file, or returns `fallback` if it's missing or broken. */
function readJson (file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (_) {
    return fallback
  }
}

/**
 * Writes JSON so a crash mid-write can't leave a half-written file: write to
 * a temporary file next to it, then rename over the original.
 */
function writeJson (file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, file)
}

module.exports = { readJson, writeJson }
