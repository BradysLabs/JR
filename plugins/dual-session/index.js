const path = require('path')
const os = require('os')
const { existsSync } = require('fs')
const { spawn } = require('child_process')

const status = document.getElementById('status')
const button = document.getElementById('launch')

function officialClientPath () {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'aj-classic', 'AJ Classic.exe')
  }
  if (process.platform === 'darwin') {
    return path.join('/', 'Applications', 'AJ Classic.app', 'Contents', 'MacOS', 'AJ Classic')
  }
  return null
}

function setStatus (message, isError = false) {
  status.textContent = message
  status.classList.toggle('error', isError)
}

button.addEventListener('click', () => {
  const exePath = officialClientPath()
  if (!exePath) {
    setStatus('This launcher currently supports Windows and macOS.', true)
    return
  }
  if (!existsSync(exePath)) {
    setStatus(`Official AJ Classic was not found at: ${exePath}`, true)
    return
  }

  button.disabled = true
  const child = spawn(exePath, [], { detached: true, stdio: 'ignore' })
  child.once('error', error => {
    setStatus(`Could not start AJ Classic: ${error.message}`, true)
    button.disabled = false
  })
  child.once('spawn', () => {
    child.removeAllListeners('error')
    child.on('error', () => {})
    child.unref()
    setStatus('Official client started. Sign in there normally.')
    setTimeout(() => { button.disabled = false }, 1500)
  })
})
