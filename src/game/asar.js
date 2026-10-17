'use strict'

/**
 * Reads and writes Electron .asar archives.
 *
 * Layout: an 8-byte size header, then a 4-byte-aligned "pickle" holding the
 * JSON directory listing, then every file's bytes back to back. File entries
 * are { size, offset } where offset is a string counted from the end of the
 * header.
 */

// Inside Electron, plain `fs` treats .asar files as folders; original-fs doesn't.
const fs = (() => { try { return require('original-fs') } catch (_) { return require('fs') } })()

function readHeader (fd) {
  const head = Buffer.alloc(16)
  fs.readSync(fd, head, 0, 16, 0)
  const headerSize = head.readUInt32LE(4) // size of the header pickle
  const jsonSize = head.readUInt32LE(12)
  const json = Buffer.alloc(jsonSize)
  fs.readSync(fd, json, 0, jsonSize, 16)
  return { header: JSON.parse(json.toString('utf8')), base: 8 + headerSize }
}

/** Opens an archive. Returns { list(), read(path), close() }. */
function open (file) {
  const fd = fs.openSync(file, 'r')
  const { header, base } = readHeader(fd)

  const entry = (p) => {
    let node = header
    for (const part of p.split('/').filter(Boolean)) {
      if (!node.files || !node.files[part]) return null
      node = node.files[part]
    }
    return node
  }

  return {
    header,
    /** Every file path, with forward slashes. */
    list () {
      const out = []
      const walk = (node, prefix) => {
        for (const [name, child] of Object.entries(node.files || {})) {
          const p = prefix ? `${prefix}/${name}` : name
          if (child.files) walk(child, p)
          else out.push(p)
        }
      }
      walk(header, '')
      return out
    },
    entry,
    read (p) {
      const e = entry(p)
      if (!e || e.files) throw new Error(`${p} is not in the archive`)
      if (e.unpacked) throw new Error(`${p} is stored outside the archive (unpacked)`)
      const buf = Buffer.alloc(e.size)
      if (e.size) fs.readSync(fd, buf, 0, e.size, base + Number(e.offset))
      return buf
    },
    close () { fs.closeSync(fd) }
  }
}

/**
 * Writes an archive.
 * @param {string} file
 * @param {Map<string, Buffer>|Array<[string, Buffer]>} files path -> contents
 * @param {{executable?: Set<string>}} [options]
 */
function write (file, files, { executable = new Set() } = {}) {
  const header = { files: {} }
  const chunks = []
  let offset = 0
  for (const [p, data] of files) {
    const parts = p.split('/').filter(Boolean)
    let node = header
    for (const dir of parts.slice(0, -1)) {
      node.files[dir] = node.files[dir] || { files: {} }
      node = node.files[dir]
    }
    const e = { size: data.length, offset: String(offset) }
    if (executable.has(p)) e.executable = true
    node.files[parts[parts.length - 1]] = e
    chunks.push(data)
    offset += data.length
  }

  const json = Buffer.from(JSON.stringify(header), 'utf8')
  const pad = (4 - (json.length % 4)) % 4
  // Header pickle: [payload size][string length][string][padding]
  const pickle = Buffer.alloc(8 + json.length + pad)
  pickle.writeUInt32LE(4 + json.length + pad, 0)
  pickle.writeUInt32LE(json.length, 4)
  json.copy(pickle, 8)
  // Size pickle: [payload size = 4][header pickle size]
  const size = Buffer.alloc(8)
  size.writeUInt32LE(4, 0)
  size.writeUInt32LE(pickle.length, 4)

  const tmp = `${file}.${process.pid}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, size)
    fs.writeSync(fd, pickle)
    for (const c of chunks) fs.writeSync(fd, c)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
}

module.exports = { open, write }
