/*
 * Bittersweets - candy collecting (adventure 46)
 *
 * From community captures: each phantom is destroyed, then its dropped
 * candy is picked up. Phantoms respawn after a few seconds, so the same
 * packets work again. Each pickup is worth 3 candy; the goal is 1,000.
 *
 *   destroy:  %xt%o%qaa%{room}%proto<N>%0%-1%0%0%
 *   pickup:   %xt%o%qat%{room}%proto<N>__give_orb%1%
 *
 * Phantoms: the adventure's start packet (qs) lists the ones that are up,
 * and the server mentions more as they move/spawn (qas/qau). If the plugin
 * didn't see the start (you used "Run here" after joining yourself), it
 * uses the list below, from a real start packet.
 *
 * Candy is counted from the pickups sent (3 each), so it's an estimate.
 */

const KNOWN = [
  1, 3, 4, 5, 7, 10, 11, 13, 14, 17, 19, 20, 21, 23, 24, 27, 29, 30, 31, 32, 33, 34, 35, 36,
  37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 48, 50, 51, 53, 55, 57, 58, 60, 62, 63, 65, 66, 67,
  68, 69, 70, 71, 72, 73, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 88, 89, 91, 93, 94, 96,
  97, 99, 100, 104, 106, 107, 111, 112, 113, 114, 115, 117, 118, 119, 123, 124, 125, 126, 129,
  130, 135, 136, 137, 138, 140, 141, 142, 143, 145, 148, 149, 151, 152, 154, 155, 159, 161,
  163, 167, 169, 170, 172, 174, 177, 179, 181, 182, 183, 184, 185, 186, 189, 190, 191, 192,
  193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211
].map(n => `proto${n}`)

const GOAL = 1000
const CANDY_PER_PICKUP = 3
const PACKET_DELAY = 150   // ms between packets
const DROP_WAIT = 500      // ms after destroying, before picking up
const RESPAWN_WAIT = 4000  // ms for the phantoms to come back

function phantoms (ctx) {
  const live = ctx.objects(/^proto\d+$/)
  const names = new Set(live.length ? live : KNOWN)
  for (let n = 36; n <= 46; n++) names.add(`proto${n}`) // seen working in testing
  return [...names].sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
}

module.exports = {
  id: 'bittersweets',
  name: 'Bittersweets candy',
  questId: 46,
  modes: ['normal'],
  handlesPrizes: true,

  steps: [
    {
      label: `Collect ${GOAL.toLocaleString()} candy`,
      run: async ctx => {
        let candy = 0
        let round = 0

        while (candy < GOAL) {
          round++
          const list = phantoms(ctx)
          ctx.status(`Round ${round}: destroying ${list.length} phantoms...`)
          for (const phantom of list) {
            await ctx.send(`%xt%o%qaa%{room}%${phantom}%0%-1%0%0%`, PACKET_DELAY)
          }

          await ctx.wait(DROP_WAIT)

          ctx.status(`Round ${round}: picking up candy...`)
          for (const phantom of list) {
            if (candy >= GOAL) break
            await ctx.send(`%xt%o%qat%{room}%${phantom}__give_orb%1%`, PACKET_DELAY)
            candy += CANDY_PER_PICKUP
          }

          ctx.status(`Round ${round} done: about ${Math.min(candy, GOAL).toLocaleString()} / ${GOAL.toLocaleString()} candy`)
          ctx.log('ok', `Round ${round}: ${list.length} phantoms, ~${Math.min(candy, GOAL)} candy`)
          if (candy >= GOAL) break

          await ctx.wait(RESPAWN_WAIT)
        }
      }
    }
  ],

  finishMessage: `Done! You should have about ${GOAL.toLocaleString()} candy - check in game.`
}
