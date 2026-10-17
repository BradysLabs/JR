'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

contextBridge.exposeInMainWorld('jr', {
  boot: () => call('jr:boot'),
  gate: {
    start: () => call('gate:start'),
    signIn: () => call('gate:sign-in'),
    check: () => call('gate:check'),
    signOut: () => call('gate:sign-out'),
    onChange: (fn) => ipcRenderer.on('gate', (e, info) => fn(info))
  },
  profiles: {
    list: () => call('profiles:list'),
    create: (name, color) => call('profiles:create', name, color),
    rename: (id, name) => call('profiles:rename', id, name),
    remove: (id) => call('profiles:remove', id),
    open: (id) => call('profiles:open', id)
  },
  openUrl: (url) => call('open-url', url),
  win: (action) => ipcRenderer.send('win', action)
})
