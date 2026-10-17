# Room Browser

Search and warp to any public room in Jamaa from a simple panel.

## Usage

1. Click **Room Browser** in the plugins sidebar to open the panel.
2. Type in the search box to filter by room name or path.
3. Click a room, then click **Join Room**. You must be logged into a room already.

## Adding rooms

Open `index.js` and add entries to the `ROOMS` list:

```js
{ c: 'Lands', name: 'My Room', path: 'some_area/room_main' }
```

- `c` is the category header it appears under.
- `name` is the label shown in the list.
- `path` is the AJ room path with slashes (e.g. `jamaa_township/room_main`).

## How it works

Joining sends one packet:

```
%xt%o%rj%<currentRoomId>%<path.with.dots>#1%1%0%0%
```

`<currentRoomId>` is the numeric id of the room you're in now, and the
destination path's slashes are swapped for dots. Some rooms (minigames,
adventure/den asset rooms) aren't directly joinable and the server will
ignore the request.
