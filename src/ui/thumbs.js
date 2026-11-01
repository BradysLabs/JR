'use strict'

/**
 * Item pictures in a plugin window's list. Put
 *   <img class="thumb" data-kind="clothing|den" data-id="" data-color="" data-version="">
 * in each row and call thumbs.watch() after drawing the list: the pictures
 * on screen are asked for (src/game/pictures.js) and filled in as the game
 * draws them. Rows scrolled past aren't asked for.
 *
 *   const thumbs = createThumbs({ pictures: jam.application.pictures, scroller: listEl })
 */

const { pictureKey } = require('../game/pictures')

function createThumbs ({ pictures, scroller, onPicture = () => {} }) {
  const wanted = new Map() // key -> item, waiting to be asked for
  let timer = null

  const itemOf = (img) => ({
    kind: img.dataset.kind === 'den' ? 'den' : 'clothing',
    id: Number(img.dataset.id),
    color: Number(img.dataset.color) || 0,
    version: Number(img.dataset.version) || 0
  })

  const fill = (img) => {
    if (!pictures) return
    const url = pictures.url(itemOf(img))
    if (url) { img.src = url; img.classList.add('ok') }
  }

  const flush = () => {
    timer = null
    if (!pictures || !wanted.size) return
    pictures.request([...wanted.values()])
    wanted.clear()
  }

  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const img = e.target
        observer.unobserve(img)
        if (img.classList.contains('ok')) continue
        const item = itemOf(img)
        wanted.set(pictureKey(item), item)
      }
      if (wanted.size && !timer) timer = setTimeout(flush, 120)
    }, { root: scroller || null, rootMargin: '120px' })
    : null

  const onReady = (key, url) => {
    if (!url) return
    // The whole window: the selected item's big picture is outside the list.
    for (const img of document.querySelectorAll(`img.thumb[data-key="${key}"]`)) { img.src = url; img.classList.add('ok') }
    onPicture(key, url)
  }
  if (pictures) pictures.on('picture', onReady)

  return {
    /** Fills in pictures JR has, and watches the rest. */
    watch (root = scroller || document) {
      for (const img of root.querySelectorAll('img.thumb')) {
        img.dataset.key = pictureKey(itemOf(img))
        fill(img)
        if (!img.classList.contains('ok') && observer) observer.observe(img)
      }
    },
    /** One picture right away (e.g. the selected item). */
    show (img) {
      img.dataset.key = pictureKey(itemOf(img))
      fill(img)
      if (!img.classList.contains('ok') && pictures) pictures.request([itemOf(img)])
    },
    dispose () {
      if (observer) observer.disconnect()
      if (pictures) pictures.off('picture', onReady)
    }
  }
}

module.exports = { createThumbs }
