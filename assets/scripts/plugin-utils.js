/*
 * Helpers for plugin windows.
 *
 * Jam adds its stylesheet to every plugin window by itself, so plugins don't
 * need to do anything to get Jam's look. This file exists so plugins that
 * include it (and call initializePluginUI) keep working.
 */
(function () {
  /**
   * Marks the page as a Jam plugin window. Safe to call more than once.
   */
  if (typeof window.initializePluginUI !== 'function') {
    window.initializePluginUI = function () {
      if (document.body) document.body.classList.add('jam-plugin')
    }
  }

  /**
   * Resolves with the jam object once Jam has attached it to this window.
   * @returns {Promise<object>}
   */
  if (typeof window.waitForJam !== 'function') {
    window.waitForJam = function () {
      return new Promise(resolve => {
        if (window.jam) return resolve(window.jam)
        const timer = setInterval(() => {
          if (window.jam) {
            clearInterval(timer)
            resolve(window.jam)
          }
        }, 50)
      })
    }
  }
})()
