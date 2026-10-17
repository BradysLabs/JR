'use strict'

/**
 * JR settings that are the same for everyone. None of these are secret.
 */
module.exports = {
  // Discord sign-in (JR is for members of the JR Discord server).
  // Leave clientId empty to turn the check off while developing.
  discord: {
    clientId: '',
    guildId: '',
    requiredRoleId: null,
    invite: 'https://discord.gg/UvXzA2gK5W'
  },

  github: { owner: 'BradysLabs', repo: 'JR' },

  // Packets plugins may send to the server each second, by default.
  packetsPerSecond: 20
}
