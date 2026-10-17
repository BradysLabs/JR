'use strict'

/**
 * Membership, by BradysLabs.
 *
 * When you log in, Animal Jam tells the game what kind of account you have.
 * This plugin changes that answer on your own computer so the game shows
 * member features. Nothing changes on Animal Jam's side.
 *
 * Console:  membership        show whether it's on
 *           membership on     turn it on (takes effect next login)
 *           membership off    turn it off (takes effect next login)
 */

const MEMBER = 2

module.exports = function membership ({ dispatch, application, storage }) {
  const say = (message, type = 'notify') => application && application.consoleMessage({ message, type })
  const isOn = () => (storage ? storage.get('enabled', true) : true)

  dispatch.onMessage({
    type: 'aj',
    message: 'login',
    callback: ({ message }) => {
      if (!isOn()) return
      const reply = message.value && message.value.b && message.value.b.o
      if (!reply || !reply.params || typeof reply.params !== 'object') return
      reply.params.accountType = MEMBER
    }
  })

  dispatch.onCommand({
    name: 'membership',
    description: 'Membership on your own game: membership on | off',
    callback: ({ parameters }) => {
      const choice = String(parameters[0] || '').toLowerCase()
      if (choice === 'on' || choice === 'off') {
        if (storage) storage.set('enabled', choice === 'on')
        say(`Membership is ${choice}. Log in again for it to take effect.`, 'success')
      } else {
        say(`Membership is ${isOn() ? 'on' : 'off'}. Type "membership on" or "membership off".`)
      }
    }
  })
}
