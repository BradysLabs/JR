'use strict'
;(async function () {
  const $ = id => document.getElementById(id)
  const jam = await new Promise(resolve => { if (window.jam) return resolve(window.jam); const t = setInterval(() => { if (window.jam) { clearInterval(t); resolve(window.jam) } }, 40) })
  const items = jam.application.items
  const root = require('path').resolve(__dirname, '..', '..')
  const fs = require('fs')
  let worth = []
  try { worth = JSON.parse(fs.readFileSync(require('path').join(root, 'data/worth/values.json'), 'utf8')).items || [] } catch (e) { $('status').textContent = `Couldn't load the bundled worth list: ${e.message}` }
  const { normalize, indexWorth, rowsFor, rowsForGameItem, describeRow, valueForRows, imageForRows } = require(require('path').join(root, 'src', 'worth', 'match.js'))
  const worthIndex = indexWorth(worth)
  const key = 'inventory-worth-items-v1'
  let owned = jam.storage.get(key, [])
  const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  function offers(row) { return row ? describeRow(row) : 'No parsed value' }
  function updateLiveInventory() {
    const file = require('path').join(jam.application.dataPath, 'plugin-data', 'inventory-worth-capture', 'inventory.json')
    let data
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (_) { $('liveStatus').textContent = 'Waiting for the game to send your clothing inventory. Open the clothing inventory in game.'; return }
    if (!items.ready) { $('liveStatus').textContent = 'Inventory received; loading game item names…'; return }
    const rows = (data.items || []).map(x => {
      const definition = items.getClothing(x.defId)
      const item = definition ? { ...definition, id: x.defId } : { id: x.defId, name: `Item #${x.defId}` }
      const name = item.name
      const matches = rowsForGameItem(worthIndex, item, x.color, items.layerColors && items.layerColors.bind(items))
      const value = valueForRows(matches)
      const resolvedColor = value !== 'No exact wiki value'
      return { name, value, matches, resolvedColor, image: imageForRows(matches) }
    })
    const totals = new Map()
    for (const entry of rows) {
      const matches = entry.matches
      if (!entry.resolvedColor || matches.length !== 1) continue
      const row = matches.find(w => w.offers && w.offers.some(o => Number.isFinite(o.min) && Number.isFinite(o.max) && o.unit && !o.bundle))
      const offer = row && row.offers.find(o => Number.isFinite(o.min) && Number.isFinite(o.max) && o.unit && !o.bundle)
      if (offer) { const t=totals.get(offer.unit)||{min:0,max:0}; t.min+=offer.min;t.max+=offer.max;totals.set(offer.unit,t) }
    }
    const summary = [...totals].map(([unit,v]) => `${v.min === v.max ? v.min : `${v.min}–${v.max}`} ${unit}`).join(' · ')
    $('liveStatus').textContent = `${rows.length.toLocaleString()} clothing items read · updated ${new Date(data.receivedAt).toLocaleString()}`
    $('liveTotal').textContent = `Estimated inventory value: ${summary || 'No exact numeric wiki values available'}.`
    $('liveItems').innerHTML = rows.map(x => `<div class="row live-row"><img class="item-img" src="${escape(x.image)}" alt="${escape(x.name)}" loading="lazy" ${x.image ? '' : 'hidden'} onerror="this.hidden=true"><div class="name">${escape(x.name)}</div><div class="value">${escape(x.value)}</div></div>`).join('') || '<div class="muted">No clothing items in the saved inventory snapshot.</div>'
  }
  function renderOwned() {
    $('owned').innerHTML = owned.length ? owned.map((x,i) => `<div class="row"><div><div class="name">${escape(x.name)}${x.variant ? ` · ${escape(x.variant)}` : ''}</div><div class="sub">${escape(x.kind)} #${x.gameId} · ${x.count} owned</div></div><div class="value">${escape(offers(x.wiki))}</div><button class="remove" data-remove="${i}">Remove</button></div>`).join('') : '<div class="muted">No items added yet.</div>'
    const quantified = owned.reduce((n,x) => n + x.count, 0)
    const priced = owned.filter(x => x.wiki && x.wiki.offers && x.wiki.offers.length).length
    const totals = new Map()
    for (const item of owned) {
      const offer = (item.wiki && item.wiki.offers || []).find(o => Number.isFinite(o.min) && Number.isFinite(o.max) && o.unit && !o.bundle)
      if (!offer) continue
      const total = totals.get(offer.unit) || { min: 0, max: 0 }
      total.min += offer.min * item.count; total.max += offer.max * item.count; totals.set(offer.unit, total)
    }
    const summary = [...totals].map(([unit,v]) => `${v.min === v.max ? v.min : `${v.min}–${v.max}`} ${unit}`).join(' · ')
    $('total').textContent = `${quantified.toLocaleString()} items tracked · ${priced.toLocaleString()} matched. Rough subtotal by unit (first numeric offer per entry): ${summary || 'not enough numeric values to total'}. Different units are kept separate; alternatives and bundles are not combined.`
    $('owned').querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { owned.splice(Number(b.dataset.remove),1); jam.storage.set(key,owned); renderOwned() })
  }
  function renderResults() {
    if (!items.ready) { $('results').innerHTML='<div class="muted">Game item names are still loading. Open the game and try again.</div>'; return }
    const q = normalize($('search').value), kind = $('kind').value
    const db = kind === 'den' ? items.den : items.clothing
    const matches = [...db.entries()].map(([id,x]) => ({id, ...x})).filter(x => !q || normalize(x.name).includes(q) || String(x.id) === q).slice(0,40)
    $('results').innerHTML = matches.map(x => {
      const variants = rowsFor(worthIndex, x.name, null)
      const options = variants.map(w => `<option value="${escape(w.id)}">${escape(offers(w))}</option>`).join('')
      return `<div class="row"><div><div class="name">${escape(x.name || `Item #${x.id}`)}</div><div class="sub">${kind} #${x.id}${variants.length ? ` · ${variants.length} wiki value match${variants.length === 1 ? '' : 'es'}` : ' · no value match in scraped wiki data'}</div></div><select data-wiki="${x.id}" ${variants.length ? '' : 'disabled'}>${options || '<option>No value match in scraped wiki data</option>'}</select><button data-add="${x.id}" ${variants.length ? '' : 'disabled'}>Add</button></div>`
    }).join('') || '<div class="muted">No matching game items.</div>'
    $('results').querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
      const id=String(b.dataset.add), x=db.get(id), variants=rowsFor(worthIndex, x && x.name, null)
      const selectedId=$('results').querySelector(`[data-wiki="${id}"]`).value
      const wiki=variants.find(w=>w.id===selectedId) || null
      const entry=owned.find(a=>a.kind===kind && a.gameId===id && a.wikiId===(wiki && wiki.id))
      if (entry) entry.count++
      else owned.push({kind,gameId:id,name:x && x.name || `Item #${id}`,variant:wiki && wiki.variant || null,count:1,wikiId:wiki && wiki.id || null,wiki:wiki || null})
      jam.storage.set(key,owned); renderOwned()
    })
  }
  $('search').addEventListener('input',renderResults); $('kind').addEventListener('change',renderResults)
  $('status').textContent = `${worth.length.toLocaleString()} wiki entries loaded · item names ${items.ready ? 'ready' : 'loading'}`
  if (!items.ready) items.load().then(renderResults).catch(e=>{$('status').textContent=`Item names unavailable: ${e.message}`})
  renderOwned(); renderResults(); updateLiveInventory(); setInterval(updateLiveInventory, 1500)
})()
