/*
 * Bittersweets - candy collecting (adventure 46)
 *
 * Destroying the phantom "proto37" drops candy that's counted straight away:
 *   %xt%o%qaa%{room}%proto37%0%-1%0%0%
 * Each one is worth 3 candy and the goal is 1,000, so JR sends it 334 times.
 *
 * Candy is counted from the packets sent (3 each), so it's an estimate.
 */

const GOAL = 1000
const CANDY_PER_PICKUP = 3
const PHANTOM = 'proto37'
const PACKET_DELAY = 350 // ms between packets

module.exports = {
  id: 'bittersweets',
  name: 'Bitter Sweets',
  questId: 46,
  modes: ['normal'],
  handlesPrizes: true,

  steps: [
    {
      label: `Collect ${GOAL.toLocaleString()} candy`,
      run: async ctx => {
        const needed = Math.ceil(GOAL / CANDY_PER_PICKUP)
        for (let n = 1; n <= needed; n++) {
          await ctx.send(`%xt%o%qaa%{room}%${PHANTOM}%0%-1%0%0%`, PACKET_DELAY)
          const candy = Math.min(n * CANDY_PER_PICKUP, GOAL)
          if (n % 10 === 0 || n === needed) ctx.status(`About ${candy.toLocaleString()} / ${GOAL.toLocaleString()} candy`)
        }
        ctx.log('ok', `Sent ${needed} pickups (~${GOAL.toLocaleString()} candy)`)
      }
    }
  ],

  finishMessage: `Done! You should have about ${GOAL.toLocaleString()} candy - check in game.`
}
