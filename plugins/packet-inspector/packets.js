const CATEGORIES = {
  movement: { label: 'Movement', color: '#60a5fa' },
  rooms: { label: 'Rooms & Dens', color: '#a78bfa' },
  chat: { label: 'Chat & Effects', color: '#f472b6' },
  shop: { label: 'Shops', color: '#fbbf24' },
  inventory: { label: 'Inventory', color: '#34d399' },
  trade: { label: 'Trading', color: '#2dd4bf' },
  currency: { label: 'Gems & Stats', color: '#facc15' },
  adventure: { label: 'Adventures', color: '#fb923c' },
  players: { label: 'Players & Buddies', color: '#38bdf8' },
  jag: { label: 'Jam-A-Grams', color: '#e879f9' },
  system: { label: 'System', color: '#94a3b8' },
  unknown: { label: 'Unknown', color: '#ef4444' }
}

const CONFIDENCE = {
  confirmed: 'Confirmed: tested in JR',
  known: 'Known: documented by the community, not re-tested',
  guess: 'Best guess: needs more captures'
}

const PUBMSG_KINDS = {
  2: 'Emote (value = emote number)',
  8: 'Glow (value = color as AARRGGBB)'
}

const PACKETS = {
  au: {
    name: 'Avatar Move', cat: 'movement', conf: 'confirmed',
    desc: 'Sent each time you move. Carries your position and size. Changing the size gets you kicked.',
    out: ['room id', 'internal id', 'x', 'y', 'size', 'state']
  },

  rj: {
    name: 'Room Join', cat: 'rooms', conf: 'confirmed',
    desc: 'Asks to warp into a room. The server replies with the new room id, which JR tracks as the current room.',
    out: ['current room id', 'destination path#instance', '?', '?', '?'],
    in: ['room id']
  },
  rx: { name: 'Room Exit', cat: 'rooms', conf: 'guess', desc: 'Leaving the current room.', out: ['room id'] },
  rc: { name: 'Room Change', cat: 'rooms', conf: 'known', desc: 'Sent when switching rooms.', out: ['room id'] },
  rp: {
    name: 'Room Info', cat: 'rooms', conf: 'known',
    desc: 'Details about the room you are in, including its path and instance.',
    in: ['room id', 'room path#instance', '?', '?', '?', '?', '?']
  },
  dj: {
    name: 'Den Join', cat: 'rooms', conf: 'known',
    desc: 'Joins a den. The second field is the den owner name.',
    out: ['room id', 'den owner', '?', '?']
  },

  pubMsg: {
    name: 'Public Message', cat: 'chat', conf: 'confirmed',
    desc: 'Room-wide message. Carries emotes and glow as "value%kind": %2 = emote, %8 = glow.',
    xml: true
  },
  uc: {
    name: 'Effect Broadcast', cat: 'chat', conf: 'confirmed',
    desc: 'The server sending a player effect to the room, e.g. the echo of a glow. Your own echoes are ignored by your game.',
    in: ['room id', 'player id', 'value', 'kind (8 = glow)', '?']
  },
  ua: {
    name: 'System Alert', cat: 'chat', conf: 'known',
    desc: 'A message box shown by the game. JR uses this for serverMessage().',
    in: ['text', '?']
  },
  dmnMsg: {
    name: 'Moderation Notice', cat: 'chat', conf: 'confirmed',
    desc: 'A server moderation notice, e.g. "You have been kicked!".',
    xml: true
  },

  gl: {
    name: 'Get Shop List', cat: 'shop', conf: 'known',
    desc: 'Asks for the contents of a shop or list.',
    out: ['room id', 'list id']
  },
  ib: {
    name: 'Buy Item', cat: 'shop', conf: 'confirmed',
    desc: 'Buys a clothing item from the shop you are in. The reply reports the result and gems left.',
    out: ['room id', 'shop id', '?', 'item id', '?', '?', '?'],
    in: ['room id', 'status (1 = ok)', 'shop id', 'gems left', '?'],
    items: { out: { 3: 'clothing' } }
  },
  db: {
    name: 'Buy Den Item', cat: 'shop', conf: 'confirmed',
    desc: 'Buys a den item from a den shop.',
    out: ['room id', '?', 'shop id', 'item id', '?', '?', '?', '?'],
    in: ['?', 'status (1 = ok)', 'gems left', '?', '?', 'den slot'],
    items: { out: { 3: 'den' } }
  },
  aa: {
    name: 'Buy Animal', cat: 'shop', conf: 'known',
    desc: 'Buys a new animal from the animal shop.',
    out: ['room id', '?', '?', '?', 'animal type id', 'custom animal id', '?', '?']
  },

  il: {
    name: 'Worn Items', cat: 'inventory', conf: 'confirmed',
    desc: 'The items an animal is wearing. Sent for every player in the room (and for you). After the item count, each item is three fields: item id, inventory slot, color.',
    in: ['room id', '?', '?', 'animal id', 'username', '?', '?', 'item count', 'item id', 'inventory slot', 'color'],
    items: { in: { 8: 'clothing' } }
  },
  iu: {
    name: 'Wear / Remove Item', cat: 'inventory', conf: 'confirmed',
    desc: 'Puts an item on or takes it off.',
    out: ['room id', '?', '1 = wear / 0 = remove', 'slot', '?']
  },
  ir: {
    name: 'Recycle Item', cat: 'inventory', conf: 'confirmed',
    desc: 'Recycles the clothing item in a slot. The reply looks like status, gem total, count.',
    out: ['room id', 'slot'],
    in: ['?', 'status (1 = ok)', 'gem total?', 'count?']
  },
  dr: {
    name: 'Recycle Den Item', cat: 'inventory', conf: 'known',
    desc: 'Recycles a den item.',
    out: ['room id', '?', 'den item id']
  },
  di: { name: 'Den Inventory', cat: 'inventory', conf: 'known', desc: 'Your den item list.' },

  ts: {
    name: 'Trade List Update', cat: 'trade', conf: 'confirmed',
    desc: 'Sets your trade list. Removed count, then (type, slot) pairs, then added count and pairs. Type 0 = clothing, 3 = pet.',
    out: ['room id', 'removed count', '(type, slot) pairs...', 'added count', '(type, slot) pairs...']
  },

  zs: {
    name: 'Stat Update', cat: 'currency', conf: 'confirmed',
    desc: 'A counter changing, e.g. gems earned. The amount is the change, not your balance.',
    in: ['-1', 'stat type', 'amount', '0']
  },
  grc: { name: 'Redeem Code', cat: 'currency', conf: 'known', desc: 'Redeems a gift code you own.', out: ['room id', 'code'] },

  qj: { name: 'Adventure Join', cat: 'adventure', conf: 'known', desc: 'Joins an adventure.' },
  qjc: {
    name: 'Adventure Create', cat: 'adventure', conf: 'known',
    desc: 'Creates a private adventure.',
    out: ['room id', 'room name', 'adventure id', '?']
  },
  qs: { name: 'Adventure Start', cat: 'adventure', conf: 'known', desc: 'Starts the joined adventure.' },
  qx: { name: 'Adventure Exit', cat: 'adventure', conf: 'known', desc: 'Leaves the adventure.' },
  qat: { name: 'Adventure Trigger', cat: 'adventure', conf: 'known', desc: 'Triggers an adventure object, e.g. a goal or treasure.', out: ['room id', 'object name', '?'] },
  qatt: { name: 'Adventure Trigger Done', cat: 'adventure', conf: 'known', desc: 'Follow-up to an adventure trigger.', out: ['room id', 'object name', '?'] },
  qpup: { name: 'Adventure Power-up', cat: 'adventure', conf: 'known', desc: 'Uses an adventure power-up.' },
  qgs: { name: 'Adventure Status', cat: 'adventure', conf: 'known', desc: 'Asks for the adventure status.', out: ['room id'] },
  qqm: { name: 'Adventure Prize List', cat: 'adventure', conf: 'guess', desc: 'Adventure prize or status data from the server.' },
  qaskr: { name: 'Adventure Reward Request', cat: 'adventure', conf: 'known', desc: 'Asks for the adventure reward.' },
  qpgift: { name: 'Adventure Prize', cat: 'adventure', conf: 'known', desc: 'Claims an adventure prize.' },
  qpgiftplr: { name: 'Adventure Player Prize', cat: 'adventure', conf: 'known', desc: 'Claims a prize for a player.', out: ['room id', 'prize index', '?', '?'] },
  qpgiftdone: { name: 'Adventure Prizes Done', cat: 'adventure', conf: 'known', desc: 'Finishes collecting adventure prizes.', out: ['room id'] },

  ac: { name: 'Player Update', cat: 'players', conf: 'guess', desc: 'Player info sent when someone appears or changes in your room.' },
  ba: { name: 'Buddy Added', cat: 'players', conf: 'known', desc: 'A buddy was added.', in: ['?', 'username', 'uuid', 'status'] },
  bl: { name: 'Buddy List', cat: 'players', conf: 'known', desc: 'Your buddy list.' },
  bon: { name: 'Buddy Online', cat: 'players', conf: 'known', desc: 'A buddy came online.', in: ['?', 'username'] },
  gps: { name: 'Player Status', cat: 'players', conf: 'known', desc: 'Asks for player status. Harmless, often used as a ping.', out: ['room id'] },
  fi: { name: 'Visibility', cat: 'players', conf: 'guess', desc: 'Related to being visible or invisible to buddies.' },

  br: {
    name: 'Den Lookup', cat: 'jag', conf: 'guess',
    desc: 'Asks for a player\'s den, e.g. when opening a Jam-A-Gram from them. The reply has their den room name ("den" + username).',
    out: ['room id', 'username'],
    in: ['room id', 'den room name', '?', '?', '?']
  },
  er: {
    name: 'Jam-A-Gram Read', cat: 'jag', conf: 'guess',
    desc: 'Opens or marks a Jam-A-Gram as read. The reply repeats the Jam-A-Gram number with a status.',
    out: ['room id', 'jam-a-gram number'],
    in: ['room id', 'jam-a-gram number', 'status (1 = ok)']
  },
  eg: {
    name: 'Jam-A-Gram Keep Gift', cat: 'jag', conf: 'guess',
    desc: 'Keeps the gift attached to a Jam-A-Gram. The item then arrives in an il packet.',
    out: ['room id', 'jam-a-gram number', '1 = keep'],
    in: ['room id', 'jam-a-gram number', 'status (1 = ok)']
  },
  es: {
    name: 'Jam-A-Gram Send', cat: 'jag', conf: 'guess',
    desc: 'Sends a Jam-A-Gram, optionally with a gift. The reply is a status.',
    out: ['room id', 'recipient', 'card id?', '?', '?', 'message text', 'has gift (1 = yes)?', 'gift item id or slot?', '?'],
    in: ['room id', 'status (1 = ok)']
  },
  ep: {
    name: 'Jam-A-Gram Received', cat: 'jag', conf: 'guess',
    desc: 'A Jam-A-Gram arriving in your inbox, with sender, card and gift details.',
    in: ['-1', 'jam-a-gram number', 'sender', 'card id?', '?', '?', '?', '?', '?', 'gift item color?', '?', '?', '?', '?', '?', '?', 'uuid', '?']
  },

  wt: {
    name: 'Jammer Wall Token', cat: 'system', conf: 'confirmed',
    desc: 'Asks the server for a token to open the Jammer Wall. Reply status 1 = token given, 0 = refused (the wall won\'t load). In early October 2026 every request was refused, in the official client too (server-side outage).',
    in: ['room id', 'status (1 ok, 0 refused)']
  },

  ka: { name: 'Keep-Alive', cat: 'system', conf: 'confirmed', desc: 'Heartbeat so the server knows you are still connected.', out: ['room id'] },
  login: { name: 'Login', cat: 'system', conf: 'known', desc: 'Login handshake (JSON).' }
}
