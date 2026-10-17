/*
 * The Forgotten Desert
 *
 * Built from a real manual run. Objectives, in order:
 *   1. Talk to Liza to begin
 *   2. Collect the gems (green, orange, blue and white areas)
 *   3. Claim the prize for each completed goal
 *   4. Turn in to Liza
 *
 * packets.json holds the collection packets from the original TFD plugin.
 * Pail pickups get your session's player ID, and every volcano touch is
 * followed by the "qaut" the real game sends.
 */

const { packets: PACKETS } = require('./packets.json')

// Number of reward goals in TFD (gui_goal1..gui_goal5).
const GOAL_COUNT = 5

module.exports = {
  id: 'tfd',
  name: 'The Forgotten Desert',
  questId: 23,
  modes: ['normal'],

  // TFD's prize list arrives compressed, so the steps claim prizes directly.
  handlesPrizes: true,

  steps: [
    {
      label: 'Talk to Liza',
      run: async ctx => {
        await ctx.send('%xt%o%qaskr%{room}%liza01_%0%1%', 3000)
      }
    },

    {
      label: 'Collect the gems',
      run: async ctx => {
        for (const packet of PACKETS) {
          if (!packet || !packet.content) continue

          const parts = packet.content.split('%')
          const command = parts[3]
          const delay = Math.max(500, (Number(packet.delay) || 0) * 1000)

          if (command === 'qpup' && parts.length >= 7) {
            // %xt%o%qpup%{room}%<pail>%<playerId>% - use this session's ID.
            parts[6] = '{player}'
            await ctx.send(parts.join('%'), delay)
            continue
          }

          await ctx.send(packet.content, delay)

          if (command === 'qat' && /socvol/i.test(parts[5] || '')) {
            await ctx.send(`%xt%o%qaut%{room}%${parts[5]}%`, 400)
          }
        }
      }
    },

    {
      label: 'Claim prizes',
      run: async ctx => {
        // For each goal the game sends: qpgift <goal - 1>, then qpgiftdone 1.
        // Goals that weren't completed are ignored by the server.
        for (let goal = 1; goal <= GOAL_COUNT; goal++) {
          await ctx.send(`%xt%o%qpgift%{room}%${goal - 1}%0%0%`, 100)
          await ctx.send('%xt%o%qpgiftdone%{room}%1%', 1000)
        }
      }
    },

    {
      label: 'Turn in to Liza',
      run: async ctx => {
        await ctx.send('%xt%o%qaskr%{room}%liza01_%5%1%', 2500)
      }
    }
  ],

  finishMessage: 'Done! Check your inventory for the prizes.'
}
