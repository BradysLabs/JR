'use strict'

/**
 * A repeating timer that never keeps JR open by itself. In JR's window
 * setInterval returns a number (no unref); under Node it returns a Timeout.
 */
function every (fn, ms) {
  const t = setInterval(fn, ms)
  if (t && typeof t.unref === 'function') t.unref()
  return t
}

module.exports = { every }
