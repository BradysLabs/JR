'use strict'

/**
 * Builds a bug report: JR and system details plus this profile's recent logs,
 * as one text file a user can drop into the JR Discord.
 *
 * Passwords, login tokens and email addresses are removed. Usernames and
 * recent game messages stay in, because they're often what shows the bug;
 * the window tells the user that before they save.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const scrub = (text) => String(text)
  .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[token]')
  .replace(/("?(auth_token|authToken|refresh_token|refreshToken|access_token|pword|password|df)"?\s*[:=]\s*"?)[^"&,}<\]\s]+/gi, '$1[hidden]')
  .replace(/(<pword><!\[CDATA\[)[^\]]*/g, '$1[hidden]')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')

/** The last `lines` lines of a file, or a note if it can't be read. */
function tail (file, lines) {
  try {
    const stat = fs.statSync(file)
    const size = Math.min(stat.size, 4 * 1024 * 1024)
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(size)
    fs.readSync(fd, buf, 0, size, stat.size - size)
    fs.closeSync(fd)
    const all = buf.toString('utf8').split(/\r?\n/)
    return all.slice(-lines).join('\n')
  } catch (error) {
    return `(couldn't read ${path.basename(file)}: ${error.code || error.message})`
  }
}

/**
 * @param {object} o
 * @param {object} o.info profile window info (version, profile, dataDir, isDev)
 * @param {object} o.engine the profile's engine
 * @param {string} [o.note] what the user says went wrong
 * @param {object} [o.versions] process.versions
 */
function buildReport ({ info, engine, note = '', versions = process.versions }) {
  const s = engine.settings || {}
  const session = engine.gameServer && engine.gameServer.session
  const plugins = (engine.host.list() || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))
  const logDir = path.join(info.dataDir, 'logs')
  const line = (k, v) => `${k.padEnd(20)} ${v}`
  const parts = [
    'JR BUG REPORT',
    '=============',
    line('Made', new Date().toISOString()),
    '',
    'WHAT HAPPENED',
    '-------------',
    String(note || '(not described)').trim(),
    '',
    'JR',
    '--',
    line('Version', `${info.version}${info.isDev ? ' (running from source)' : ''}`),
    line('Profile', info.profile && info.profile.name),
    line('Connected', engine.dispatch.connected ? 'yes' : 'no'),
    line('Game open', engine.gameRunning ? 'yes' : 'no'),
    line('Game server', session && session.upstream ? session.upstream.host : '-'),
    line('Game version', session && session.version ? session.version : '-'),
    line('Item names', engine.items.ready ? `loaded (game ${engine.items.deployVersion})` : 'not loaded'),
    line('Room', engine.dispatch.getState('roomName') || '-'),
    '',
    'SETTINGS',
    '--------',
    line('Theme', s.theme || 'midnight'),
    line('Anti-kick', s.antiKick ? 'on' : 'off'),
    line('Streaming mode', s.streamingMode ? 'on' : 'off'),
    line('Packet limit', `${s.packetsPerSecond}/s`),
    line('Secure upstream', s.secureUpstream === false ? 'off' : 'on'),
    '',
    'COMPUTER',
    '--------',
    line('System', `${os.type()} ${os.release()} (${os.arch()})`),
    line('Electron', versions.electron || '-'),
    line('Chrome', versions.chrome || '-'),
    line('Node', versions.node || '-'),
    line('Memory', `${Math.round(os.totalmem() / 1073741824)} GB`),
    '',
    `PLUGINS (${plugins.length})`,
    '-------',
    ...plugins.map(p => `${String(p.name).padEnd(24)} ${p.status}${p.builtIn === false ? ' · added by user' : ''}${p.errors && p.errors.length ? ` · ${p.errors.join(' ')}` : ''}`),
    '',
    'JR LOG (latest)',
    '---------------',
    tail(path.join(logDir, 'jr.log'), 400),
    '',
    'GAME MESSAGES (latest)',
    '----------------------',
    tail(path.join(logDir, 'packets.log'), 600)
  ]
  return scrub(parts.join('\n'))
}

module.exports = { buildReport, scrub, tail }
