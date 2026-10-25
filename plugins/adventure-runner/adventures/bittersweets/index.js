/*
 * Bitter Sweets (adventure 46)
 *
 * Each reward goal is one packet: telling the game the goal was met gives
 * that goal's set of chests (from the JR community's notes):
 *   %xt%o%qat%{room}%gui_goal1%0%   100 candy
 *   %xt%o%qat%{room}%gui_goal2%0%   200 candy
 *   %xt%o%qat%{room}%gui_goal3%0%   400 candy
 *   gui_goal4, gui_goal5            the later rewards
 * Tick the goals you want in the Adventures window.
 */

const GOALS = [
  { id: 'goal1', label: 'Goal 1', title: '100 candy: first set of chests' },
  { id: 'goal2', label: 'Goal 2', title: '200 candy: second set of chests' },
  { id: 'goal3', label: 'Goal 3', title: '400 candy: third set of chests' },
  { id: 'goal4', label: 'Goal 4', title: 'Fourth reward' },
  { id: 'goal5', label: 'Goal 5', title: 'Fifth reward' }
]
const PRIZE_WAIT = 3000 // ms to wait for a goal's prize screen
const NO_SCREEN_WAIT = 5000 // ms to give the chests if no prize screen opens

module.exports = {
  id: 'bittersweets',
  name: 'Bitter Sweets',
  questId: 46,
  modes: ['normal'],
  // Each goal's prize is collected right after that goal (see the step).
  handlesPrizes: true,

  choices: { label: 'Rewards', options: GOALS, defaults: GOALS.map(g => g.id) },

  steps: [
    {
      label: 'Claim the reward goals',
      run: async ctx => {
        const picked = GOALS.filter(g => ctx.choices.includes(g.id))
        for (const goal of picked) {
          // One goal at a time: claim it, then let its prize be collected
          // before the next, so rewards aren't lost by going too fast.
          ctx.newPrize()
          ctx.status(`${goal.label}: claiming...`)
          await ctx.send(`%xt%o%qat%{room}%gui_${goal.id}%0%`, 500)
          ctx.status(`${goal.label}: collecting the prize...`)
          const screen = await ctx.collectPrize(PRIZE_WAIT)
          if (!screen) await ctx.wait(NO_SCREEN_WAIT)
          ctx.log('ok', `${goal.label} done (${goal.title}).`)
        }
      }
    }
  ],

  finishMessage: 'Done! Open your chests in the adventure.'
}
