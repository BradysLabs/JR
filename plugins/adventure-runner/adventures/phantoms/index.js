/*
 * Return of the Phantoms - bunnies only
 *
 * Skips the pipes, plants and phantom door. Just grabs the four bunny
 * keys, frees the four caged bunnies, and talks to Liza.
 *
 * Bunny keys are random each run; ctx.active() returns the ones the
 * server announced after the adventure started.
 */

module.exports = {
  id: 'phantoms-bunnies',
  name: 'Phantoms',
  questId: 14,
  modes: ['hard', 'easy'],

  afterStart: async ctx => {
    await ctx.trigger('questready');
  },

  steps: [
    {
      label: 'Rescue the bunnies',
      run: async ctx => {
        // Key group N opens a specific cage (from a real run).
        const cageForKey = { 1: 'bunny_7', 4: 'bunny_10', 3: 'bunny_8', 2: 'bunny_9' };

        for (const group of [1, 4, 3, 2]) {
          const keys = ctx.active(`bunny_key_${group}`).sort();
          const key = keys[keys.length - 1] || `bunny_key_${group}f`;
          await ctx.pickup(key);
          await ctx.trigger(cageForKey[group]);
        }
      }
    },

    {
      label: 'Talk to Liza',
      run: async ctx => {
        await ctx.trigger('liza_2');
        await ctx.send('%xt%o%qaskr%{room}%liza_2%1%1%');
      }
    }
  ],

  finishMessage: 'Done! If the prize screen opened, pick your prize.'
};