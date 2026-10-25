/*
 * Tiki Trouble
 *
 * A solo adventure (quest 40): leave the host box empty and JR starts your
 * own game. Order, from a real run:
 *   1. Talk to the guide to begin
 *   2. Open the treasure chests (each needs the "touch" and then "open")
 *   3. Pick up a pearl and hand it in, three times. The game only takes the
 *      next pearl after a long wait, so JR waits between them.
 */

const CHESTS = ['av_treasure', 'treasure1', 'treasure2', 'treasure3', 'treasure4', 'treasure5']
const PEARLS = 3
const PEARL_WAIT = 150 * 1000 // between hand-ins

module.exports = {
  id: 'tiki-trouble',
  name: 'Tiki Trouble',
  questId: 40,
  modes: ['normal'],
  solo: true,

  // The chests are the prizes; there's no prize screen to wait for.
  handlesPrizes: true,

  steps: [
    {
      label: 'Talk to the guide',
      run: async ctx => {
        await ctx.send('%xt%o%qaskr%{room}%alpha0%0%1%', 2000)
      }
    },

    {
      label: 'Open the treasure chests',
      run: async ctx => {
        // The first chest is behind the Arctic Wolf gate; the game skips it for other animals.
        for (const chest of CHESTS) {
          await ctx.send(`%xt%o%qat%{room}%${chest}%0%`, 500)
          await ctx.send(`%xt%o%qatt%{room}%${chest}%1%`, 500)
        }
      }
    },

    {
      label: `Hand in ${PEARLS} pearls`,
      run: async ctx => {
        for (let n = 1; n <= PEARLS; n++) {
          await ctx.pickup('tikipearl3')
          await ctx.trigger('alpha1')
          ctx.log('info', `Pearl ${n} of ${PEARLS} handed in.`)
          if (n < PEARLS) {
            ctx.status(`Pearl ${n} of ${PEARLS} done. The next one can go in about ${Math.round(PEARL_WAIT / 60000 * 2) / 2} minutes...`)
            await ctx.wait(PEARL_WAIT)
          }
        }
      }
    }
  ],

  finishMessage: 'Done! Check your inventory for the treasure.'
}
