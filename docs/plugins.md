# Writing JR plugins

A plugin is a folder with a `plugin.json`. Plugins made for Jam Reborn work in JR without changes.

There are two kinds:

| Kind | `type` | What it is |
|---|---|---|
| Window plugin | `"ui"` | An HTML page that opens in its own window. |
| Background plugin | `"game"` | A JavaScript module that runs while JR is open. Good for console commands and packet hooks. |

## plugin.json

```json
{
  "name": "My Plugin",
  "description": "One sentence about what it does.",
  "author": "YourName",
  "type": "ui",
  "main": "index.html",
  "category": "Tools",
  "icon": "fa-wrench"
}
```

`name` is required. If `type` or `main` is missing, JR uses `index.html` (window plugin) or `index.js` (background plugin), whichever the folder has.

## Approval

Plugins that don't ship with JR only run after the user approves them. If a plugin's files change, JR asks again. Approval is per profile.

## Saved data

Each profile keeps its own copy of every plugin's data, so two profiles running the same plugin never share data.

- `storage.get(key, fallback)`, `storage.set(key, value)`, `storage.delete(key)`, `storage.all()` save small values (anything JSON can hold).
- `dataPath` is a folder for your plugin's files in this profile. Create it before writing to it.
- In window plugins, `localStorage` is also kept per profile.

## Background plugins

```js
module.exports = function ({ dispatch, application, storage, dataPath }) {
  dispatch.onCommand({
    name: 'hello',
    description: 'Says hello.',
    callback: ({ parameters }) => {
      application.consoleMessage({ message: `Hello ${parameters[0] || 'there'}!`, type: 'success' })
    }
  })

  // Optional: return a function that runs when the plugin stops.
  return () => {}
}
```

When a plugin stops (turned off, reloaded or JR closing), JR removes its hooks, commands, packet watchers and intervals for it.

## Window plugins

The page gets `window.jam`:

| | |
|---|---|
| `jam.dispatch` | Packets, state and hooks (below). |
| `jam.application` | `consoleMessage()`, settings and item names (`jam.application.items`). |
| `jam.onPacket(fn)` | Watch every packet. |
| `jam.storage`, `jam.dataPath` | Saved data for this profile. |

Everything the window hooks is removed when it closes.

## Packets

Most game traffic looks like this:

```
%xt%o%qat%844480%questready%0%       game -> server ("o" = outgoing), command "qat"
%xt%rj%-1%1%denYourName%844480%      server -> game, command "rj"
```

`message.value` is the packet split on `%`. The command is at index 3 for packets from the game and index 2 for packets from the server. For JSON messages, `message.value` is the parsed object and the command is `value.b.o._cmd`.

### Watching

```js
const stop = jam.onPacket(packet => {
  // packet.raw, packet.direction ('in' to the game, 'out' to the server),
  // packet.type (the command), packet.fromPlugin, packet.blocked, packet.timestamp
})
```

### Hooking (change or block)

```js
dispatch.onMessage({
  type: 'aj',          // 'aj' = from the server, 'connection' = from the game, '*' = both
  message: 'rj',       // the command; leave out for every packet
  callback: ({ message }) => {
    // change message.value, or set message.send = false to block it
  }
})
dispatch.offMessage({ type: 'aj', message: 'rj', callback })
```

Hooks can be `async`. Packets stay in order while JR waits.

### Sending

```js
const room = dispatch.getState('room')
await dispatch.sendRemoteMessage(`%xt%o%qat%${room}%questready%0%`)  // to the server
dispatch.sendConnectionMessage('%xt%ua%Hello!%0%')                  // to your game only
dispatch.serverMessage('Hello!')                                    // message box in your game
await dispatch.sendMultipleMessages({ type: 'aj', messages: [...], delay: 100 })
```

Packets to the server are limited to 20 per second by default. Extra packets wait their turn. Sending too fast, or packets the server doesn't expect, can get an account kicked or banned.

## State

| Key | Value |
|---|---|
| `getState('room')` | The current room number, used in most packets. |
| `getState('internalRoomId')` | Same as `room`. |
| `getState('roomName')` | The room's name, e.g. `denYourName`. |
| `getState('player')` | Your player data from the login reply. |

`setState(key, value)` stores your own values. `dispatch.connected` is true while the game is connected.

## Helpers

| | |
|---|---|
| `dispatch.wait(ms)` | Waits `ms` milliseconds. |
| `dispatch.setInterval(fn, ms)` / `dispatch.clearInterval(id)` | Intervals JR stops on disconnect. |
| `application.consoleMessage({ message, type })` | Prints to JR's Logs. `type`: `success`, `error`, `warn`, `notify`. |
