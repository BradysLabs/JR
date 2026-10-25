'use strict'

/**
 * My Shop Restocker, by BradysLabs: runs in the background so templates and
 * automatic refills keep working while the My Shop Templates window is closed.
 */

const { ShopService } = require('./shop')

module.exports = function shopRestocker ({ dispatch, application, storage }) {
  const service = new ShopService({
    dispatch,
    items: application && application.items,
    storage,
    notify: application && typeof application.notify === 'function' ? (n) => application.notify(n) : undefined,
    log: application && typeof application.consoleMessage === 'function' ? (message) => application.consoleMessage({ type: 'notify', message }) : undefined
  })

  // The My Shop Templates window talks to this.
  const api = {
    version: 2, // 2: outfits take off first, confirm colors, rejoin, log each step
    snapshot: () => service.snapshot(),
    readShop: (shopId) => service.readShop(Number(shopId)),
    saveTemplate: (shopId, name) => service.saveTemplate(Number(shopId), name),
    renameTemplate: (id, name) => service.renameTemplate(id, name),
    deleteTemplate: (id) => service.deleteTemplate(id),
    setPrice: (id, index, cost, currency) => service.setPrice(id, Number(index), cost, currency),
    removeTemplateItem: (id, index) => service.removeTemplateItem(id, Number(index)),
    availability: (id) => service.availability(id),
    restock: (shopId, templateId) => service.restock(Number(shopId), templateId),
    setAuto: (shopId, templateId, when) => service.setAuto(Number(shopId), templateId, when),
    renameShop: (shopId, name) => service.renameShop(Number(shopId), name),
    clearSales: () => service.clearSales(),
    explorer: () => service.explorer(),
    browseShop: (standId) => service.browseShop(Number(standId)),
    scanDen: () => service.scanDen(),
    stopScan: () => service.stopScan(),
    inventory: () => service.inventory(),
    currentOutfit: () => service.currentOutfit(),
    wearOutfit: (outfit, parts) => service.wearOutfit(outfit, parts),
    planRecycle: (entries) => service.planRecycle(entries),
    recycleNow: (entries, label) => service.recycleNow(entries, { label }),
    stopRecycle: () => service.stopRecycle(),
    setAutoRecycle: (preset) => service.setAutoRecycle(preset),
    recycleSnapshot: () => service.recycleSnapshot(),
    salesCsv: () => service.salesCsv()
  }
  dispatch.setState('shopTemplates', api)

  return () => {
    service.dispose()
    if (dispatch.getState('shopTemplates') === api) dispatch.setState('shopTemplates', null)
  }
}
