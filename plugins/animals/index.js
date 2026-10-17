const { dispatch } = jam


/* ============================================================
   Animal Jam Classic Animal Database
   Source:
     Defpack 1003
     String pack 10230

   id           = animal definition ID
   name         = resolved titleStrRef
   titleStrRef  = source string reference
   membersOnly  = source membersOnly value
   cost         = source cost value
   ============================================================ */

const ANIMALS = [
  {
    id: 1,
    name: 'Tiger',
    titleStrRef: 1711,
    membersOnly: false,
    cost: 1000
  },

  {
    id: 2,
    name: 'Eagle',
    titleStrRef: 15091,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 3,
    name: 'Deer',
    titleStrRef: 4041,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 4,
    name: 'Wolf',
    titleStrRef: 1715,
    membersOnly: false,
    cost: 1000
  },

  {
    id: 5,
    name: 'Koala',
    titleStrRef: 1713,
    membersOnly: false,
    cost: 1000
  },

  {
    id: 6,
    name: 'Panda',
    titleStrRef: 1712,
    membersOnly: false,
    cost: 1000
  },

  {
    id: 7,
    name: 'Monkey',
    titleStrRef: 1714,
    membersOnly: false,
    cost: 1000
  },

  {
    id: 8,
    name: 'Bunny',
    titleStrRef: 1710,
    membersOnly: false,
    cost: 1000
  },

  {
    id: 9,
    name: 'Hyena',
    titleStrRef: 18200,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 10,
    name: 'Otter',
    titleStrRef: 18569,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 11,
    name: 'Polar Bear',
    titleStrRef: 19721,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 12,
    name: 'Owl',
    titleStrRef: 21275,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 13,
    name: 'Rhino',
    titleStrRef: 1724,
    membersOnly: false,
    cost: 1000
  },

  {
    id: 14,
    name: 'Penguin',
    titleStrRef: 1822,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 15,
    name: 'Crocodile',
    titleStrRef: 1716,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 16,
    name: 'Elephant',
    titleStrRef: 1718,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 17,
    name: 'Lion',
    titleStrRef: 1719,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 18,
    name: 'Seal',
    titleStrRef: 1717,
    membersOnly: false,
    cost: 1000
  },

  {
    id: 19,
    name: 'Dolphin',
    titleStrRef: 1722,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 20,
    name: 'Shark',
    titleStrRef: 1721,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 21,
    name: 'Octopus',
    titleStrRef: 1726,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 22,
    name: 'Sea Turtle',
    titleStrRef: 1723,
    membersOnly: false,
    cost: 1000
  },

  {
    id: 23,
    name: 'Horse',
    titleStrRef: 1720,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 24,
    name: 'Penguin',
    titleStrRef: 1822,
    membersOnly: false,
    cost: 1000
  },

  {
    id: 25,
    name: 'Fox',
    titleStrRef: 2630,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 26,
    name: 'Giraffe',
    titleStrRef: 2772,
    membersOnly: false,
    cost: 1000
  },

  {
    id: 27,
    name: 'Kangaroo',
    titleStrRef: 3581,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 28,
    name: 'Arctic Wolf',
    titleStrRef: 2777,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 29,
    name: 'Snow Leopard',
    titleStrRef: 2915,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 30,
    name: 'Raccoon',
    titleStrRef: 3127,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 31,
    name: 'Cheetah',
    titleStrRef: 4111,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 32,
    name: 'Lynx',
    titleStrRef: 23319,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 33,
    name: 'Arctic Fox',
    titleStrRef: 24089,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 34,
    name: 'Goat',
    titleStrRef: 24568,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 35,
    name: 'Falcon',
    titleStrRef: 24789,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 36,
    name: 'Pig',
    titleStrRef: 25313,
    membersOnly: false,
    cost: 1000
  },

  {
    id: 37,
    name: 'Sloth',
    titleStrRef: 25420,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 38,
    name: 'Lemur',
    titleStrRef: 27365,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 39,
    name: 'Toucan',
    titleStrRef: 28180,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 40,
    name: 'Sheep',
    titleStrRef: 28669,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 41,
    name: 'Cougar',
    titleStrRef: 29273,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 42,
    name: 'Coyote',
    titleStrRef: 29274,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 43,
    name: 'Flamingo',
    titleStrRef: 29275,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 44,
    name: 'Red Panda',
    titleStrRef: 29276,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 45,
    name: 'Clydesdale Horse',
    titleStrRef: 31989,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 46,
    name: 'Sabertooth',
    titleStrRef: 32502,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 47,
    name: 'Direwolf',
    titleStrRef: 32635,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 48,
    name: 'Skunk',
    titleStrRef: 34053,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 49,
    name: 'Great Horned Owl',
    titleStrRef: 33763,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 50,
    name: 'Fennec Fox',
    titleStrRef: 34273,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 51,
    name: 'Camel',
    titleStrRef: 34489,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 52,
    name: 'Arabian Horse',
    titleStrRef: 34698,
    membersOnly: true,
    cost: 1000
  },

  {
    id: 53,
    name: 'Moose',
    titleStrRef: 34912,
    membersOnly: true,
    cost: 1000
  }
]


/* ============================================================
   Packet format
   ============================================================ */

/* ============================================================
   Storage
   ============================================================ */

const HISTORY_KEY =
  'animalBuyerHistory'

const FAVORITES_KEY =
  'animalBuyerFavorites'

const MAX_HISTORY =
  12


/* ============================================================
   State
   ============================================================ */

const state = {
  selected: null,
  filtered: [...ANIMALS]
}

// These fields are supplied by the live game request and can change between
// sessions. Never persist them; capture a fresh template from the game.
let purchaseTemplate = null


/* ============================================================
   DOM helper
   ============================================================ */

const $ =
  id => document.getElementById(id)


/* ============================================================
   Packet
   ============================================================ */

function buildPacket (
  animalId
) {
  if (!purchaseTemplate) return null

  const parts = [...purchaseTemplate]
  const roomId = dispatch.getState('room')
  if (/^\d+$/.test(String(roomId || ''))) {
    parts[4] = String(roomId)
  }
  parts[8] = String(animalId)
  return parts.join('%')
}


function parseAnimalPacket (raw) {
  if (typeof raw !== 'string') return null

  const parts = raw.trim().split('%')
  if (
    parts[0] !== '' ||
    parts[1] !== 'xt' ||
    parts[2] !== 'o' ||
    parts[3] !== 'aa' ||
    parts.length < 13 ||
    !/^\d+$/.test(parts[8])
  ) return null

  return {
    parts,
    animalId: Number(parts[8])
  }
}


function capturePurchaseTemplate (packet) {
  if (
    !packet ||
    packet.direction !== 'out' ||
    packet.fromPlugin ||
    typeof packet.raw !== 'string'
  ) return

  const captured = parseAnimalPacket(packet.raw)
  if (!captured) return

  purchaseTemplate = captured.parts
  $('packetHelp').textContent =
    `Captured the current in-game request for animal ID ${captured.animalId}. Edit the packet as needed; Purchase sends the text shown.`

  renderSelected()
  setStatus(
    'Captured a current animal request from the game.',
    'success'
  )
}


/* ============================================================
   Status
   ============================================================ */

function setStatus (
  message,
  type = ''
) {
  const el =
    $('status')

  el.textContent =
    message

  el.className =
    type
      ? type
      : ''
}


/* ============================================================
   Favorites
   ============================================================ */

function getFavorites () {
  try {
    const raw =
      localStorage.getItem(
        FAVORITES_KEY
      )

    const parsed =
      raw
        ? JSON.parse(raw)
        : []

    return Array.isArray(parsed)
      ? parsed.map(Number)
      : []

  } catch {
    return []
  }
}

function isFavorite (
  id
) {
  return getFavorites()
    .includes(Number(id))
}

function toggleFavorite (
  id
) {
  let favorites =
    getFavorites()

  id =
    Number(id)

  if (
    favorites.includes(id)
  ) {
    favorites =
      favorites.filter(
        x => x !== id
      )
  } else {
    favorites.push(id)
  }

  try {
    localStorage.setItem(
      FAVORITES_KEY,
      JSON.stringify(favorites)
    )
  } catch {
    // Ignore storage errors.
  }

  renderResults()
}


/* ============================================================
   History
   ============================================================ */

function getHistory () {
  try {
    const raw =
      localStorage.getItem(
        HISTORY_KEY
      )

    const parsed =
      raw
        ? JSON.parse(raw)
        : []

    return Array.isArray(parsed)
      ? parsed.map(Number)
      : []

  } catch {
    return []
  }
}

function saveHistory (
  id
) {
  id =
    Number(id)

  let history =
    getHistory()

  history =
    history.filter(
      x => x !== id
    )

  history.unshift(
    id
  )

  history =
    history.slice(
      0,
      MAX_HISTORY
    )

  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(history)
    )
  } catch {
    // Ignore storage errors.
  }

  renderHistory()
}


/* ============================================================
   Animal lookup
   ============================================================ */

function getAnimal (
  id
) {
  return ANIMALS.find(
    animal =>
      Number(animal.id) ===
      Number(id)
  ) || null
}


/* ============================================================
   Select animal
   ============================================================ */

function selectAnimal (
  id
) {
  const animal =
    getAnimal(id)

  if (!animal) {
    return
  }

  state.selected =
    animal.id

  renderSelected()

  renderResults()

  setStatus(
    `${animal.name} selected.`
  )
}


/* ============================================================
   Search
   ============================================================ */

function filterAnimals () {
  const query =
    $('search')
      .value
      .trim()
      .toLowerCase()

  if (!query) {
    state.filtered =
      [...ANIMALS]

    renderResults()

    return
  }

  state.filtered =
    ANIMALS.filter(
      animal => {

        const name =
          animal.name
            .toLowerCase()

        const id =
          String(animal.id)

        return (
          name.includes(query) ||
          id.includes(query)
        )
      }
    )

  renderResults()
}


/* ============================================================
   Results
   ============================================================ */

function renderResults () {
  const container =
    $('results')

  container.innerHTML =
    ''

  const favorites =
    getFavorites()

  $('resultCount').textContent =
    `${state.filtered.length} of ${ANIMALS.length} animals`

  if (
    !state.filtered.length
  ) {
    container.innerHTML =
      '<div class="empty">' +
      'No animals match your search.' +
      '</div>'

    return
  }

  const sorted =
    [...state.filtered].sort(
      (a, b) => {

        const af =
          favorites.includes(a.id)

        const bf =
          favorites.includes(b.id)

        if (
          af !== bf
        ) {
          return bf - af
        }

        return a.id - b.id
      }
    )

  sorted.forEach(
    animal => {

      const row =
        document.createElement(
          'div'
        )

      row.className =
        'animal-row' +
        (
          state.selected ===
          animal.id
            ? ' selected'
            : ''
        )

      const main =
        document.createElement(
          'div'
        )

      main.className =
        'animal-main'

      const name =
        document.createElement(
          'div'
        )

      name.className =
        'animal-name'

      name.textContent =
        animal.name

      const meta =
        document.createElement(
          'div'
        )

      meta.className =
        'animal-meta'

      meta.textContent =
        `ID ${animal.id} · ` +
        (
          animal.membersOnly
            ? 'Members'
            : 'Free'
        )

      main.appendChild(
        name
      )

      main.appendChild(
        meta
      )


      const actions =
        document.createElement(
          'div'
        )

      actions.className =
        'animal-actions'


      const favorite =
        document.createElement(
          'button'
        )

      favorite.type =
        'button'

      favorite.className =
        'small-button favorite' +
        (
          favorites.includes(
            animal.id
          )
            ? ' active'
            : ''
        )

      favorite.textContent =
        favorites.includes(
          animal.id
        )
          ? '★'
          : '☆'

      favorite.title =
        'Favorite'

      favorite.addEventListener(
        'click',
        event => {

          event.stopPropagation()

          toggleFavorite(
            animal.id
          )
        }
      )


      const select =
        document.createElement(
          'button'
        )

      select.type =
        'button'

      select.className =
        'small-button'

      select.textContent =
        'Select'

      select.addEventListener(
        'click',
        event => {

          event.stopPropagation()

          selectAnimal(
            animal.id
          )
        }
      )


      actions.appendChild(
        favorite
      )

      actions.appendChild(
        select
      )


      row.appendChild(
        main
      )

      row.appendChild(
        actions
      )


      row.addEventListener(
        'click',
        () =>
          selectAnimal(
            animal.id
          )
      )


      container.appendChild(
        row
      )
    }
  )
}


/* ============================================================
   Selected panel
   ============================================================ */

function renderSelected () {
  const animal =
    getAnimal(
      state.selected
    )

  if (!animal) {

    $('selectedName').textContent =
      'Select an animal'

    $('selectedId').textContent =
      '—'

    $('selectedCost').textContent =
      '—'

    $('selectedMembers').textContent =
      '—'

    $('selectedRef').textContent =
      '—'

    $('badges').innerHTML =
      ''

    $('packet').value =
      'Select an animal to generate the packet.'

    $('packetHelp').textContent = purchaseTemplate
      ? 'Current in-game request template captured.'
      : 'Make a normal animal purchase in the game first so Animal Buyer can capture the current request fields.'

    $('purchase').disabled = true

    return
  }


  $('selectedName').textContent =
    animal.name

  $('selectedId').textContent =
    animal.id

  $('selectedCost').textContent =
    animal.cost.toLocaleString()

  $('selectedMembers').textContent =
    animal.membersOnly
      ? 'Yes'
      : 'No'

  $('selectedRef').textContent =
    animal.titleStrRef


  $('badges').innerHTML = `
    <span class="badge">
      Animal #${animal.id}
    </span>

    ${
      animal.membersOnly
        ? '<span class="badge member">Members Only</span>'
        : '<span class="badge free">Free Access</span>'
    }

    <span class="badge">
      1003
    </span>

    <span class="badge">
      String ${animal.titleStrRef}
    </span>
  `


  $('packet').value =
    buildPacket(animal.id) ||
    'No current request template captured. Make a normal animal purchase in the game first.'

  $('packetHelp').textContent = purchaseTemplate
    ? 'Editable packet. Purchase sends the text shown in this field.'
    : 'Make a normal animal purchase in the game first so Animal Buyer can capture the current request fields.'

  $('purchase').disabled =
    !purchaseTemplate
}


/* ============================================================
   History rendering
   ============================================================ */

function renderHistory () {
  const container =
    $('history')

  container.innerHTML =
    ''

  const history =
    getHistory()

  if (
    !history.length
  ) {

    container.innerHTML =
      '<div class="empty">' +
      'No recent animals.' +
      '</div>'

    return
  }


  history.forEach(
    id => {

      const animal =
        getAnimal(id)

      if (!animal) {
        return
      }


      const row =
        document.createElement(
          'div'
        )

      row.className =
        'history-row'


      const label =
        document.createElement(
          'div'
        )

      const name =
        document.createElement(
          'span'
        )

      name.className =
        'history-name'

      name.textContent =
        animal.name

      const idText =
        document.createElement(
          'span'
        )

      idText.className =
        'history-id'

      idText.textContent =
        `#${animal.id}`

      label.appendChild(
        name
      )

      label.appendChild(
        idText
      )


      const use =
        document.createElement(
          'button'
        )

      use.type =
        'button'

      use.className =
        'small-button'

      use.textContent =
        'Use'

      use.addEventListener(
        'click',
        () =>
          selectAnimal(
            animal.id
          )
      )


      row.appendChild(
        label
      )

      row.appendChild(
        use
      )

      container.appendChild(
        row
      )
    }
  )
}


/* ============================================================
   Purchase
   ============================================================ */

async function purchaseSelected () {
  const animal =
    getAnimal(
      state.selected
    )

  if (!animal) {

    setStatus(
      'Select an animal first.',
      'error'
    )

    return
  }

  if (!purchaseTemplate) {
    setStatus(
      'Make a normal animal purchase in the game first so Animal Buyer can capture the current request fields.',
      'warning'
    )
    return
  }


  const rawPacket = $('packet').value
  const parsedPacket = parseAnimalPacket(rawPacket)
  if (!parsedPacket) {
    setStatus(
      'Packet format is invalid. Expected an outgoing aa animal-purchase packet with a numeric animal ID.',
      'error'
    )
    return
  }

  const packet = rawPacket.trim()
  const requestedAnimal = getAnimal(parsedPacket.animalId)
  const requestLabel = requestedAnimal
    ? requestedAnimal.name
    : `animal ID ${parsedPacket.animalId}`

  const button =
    $('purchase')


  button.disabled =
    true

  button.textContent =
    'Sending...'


  setStatus(
    `Sending purchase request for ${requestLabel}...`,
    'warning'
  )


  try {

    const results = await dispatch.sendRemoteMessage(packet)
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error('No active game connection was available.')
    }


    saveHistory(parsedPacket.animalId)


    setStatus(
      `${requestLabel} request sent. Check the game for the server result.`,
      'warning'
    )


  } catch (error) {

    console.error(
      'Animal Buyer error:',
      error
    )


    setStatus(
      `Failed to send packet: ${error.message || error}`,
      'error'
    )
  } finally {
    button.disabled = !state.selected || !purchaseTemplate
    button.textContent = 'Purchase Selected Animal'
  }
}


/* ============================================================
   Events
   ============================================================ */

document.addEventListener(
  'DOMContentLoaded',
  () => {

    if (typeof jam.onPacket === 'function') {
      jam.onPacket(capturePurchaseTemplate)
    } else {
      setStatus(
        'This JR version cannot capture the current animal request. Update JR and reopen Animal Buyer.',
        'error'
      )
    }

    $('search').addEventListener(
      'input',
      filterAnimals
    )


    $('clearSearch').addEventListener(
      'click',
      () => {

        $('search').value =
          ''

        filterAnimals()

        $('search').focus()
      }
    )


    $('purchase').addEventListener(
      'click',
      purchaseSelected
    )


    $('search').addEventListener(
      'keydown',
      event => {

        if (
          event.key !==
          'Enter'
        ) {
          return
        }

        event.preventDefault()


        /*
         * Enter selects the only
         * matching animal, or
         * purchases the currently
         * selected animal when
         * there is no unique match.
         */

        if (
          state.filtered.length ===
          1
        ) {

          selectAnimal(
            state.filtered[0].id
          )

          return
        }


        if (
          state.selected
        ) {
          purchaseSelected()
        }
      }
    )


    document.addEventListener(
      'keydown',
      event => {

        if (
          (
            event.ctrlKey ||
            event.metaKey
          ) &&
          event.key.toLowerCase() ===
            'f'
        ) {

          event.preventDefault()

          $('search').focus()
        }
      }
    )


    renderResults()

    renderSelected()

    renderHistory()

    $('search').focus()
  }
)
