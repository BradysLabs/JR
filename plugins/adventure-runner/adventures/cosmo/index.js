/*
 * Meet Cosmo
 *
 * From a real run:
 *   %xt%o%qat%{room}%cosmo_2%0%              talk to Cosmo
 *   %xt%o%qaskr%{room}%cosmo_2%51%1%         accept his request
 *   %xt%o%qat%{room}%pickup_straw%0%         go to the strawberry
 *   %xt%o%qpup%{room}%ga_strawbery%{player}% pick it up (server answers %xt%qpup%-1%1%...)
 *   %xt%o%qat%{room}%cosmo_2%0%              bring it back to Cosmo
 *
 * The adventure's number for joining by name isn't known yet, so this one
 * runs with "Run here" once you're in it.
 */

module.exports = {
  id: 'meet-cosmo',
  name: 'Meet Cosmo',
  questId: null,
  modes: ['normal'],

  steps: [
    {
      label: 'Talk to Cosmo',
      run: async ctx => {
        await ctx.trigger('cosmo_2')
        await ctx.send('%xt%o%qaskr%{room}%cosmo_2%51%1%')
      }
    },
    {
      label: 'Pick the strawberry',
      run: async ctx => {
        await ctx.trigger('pickup_straw')
        await ctx.pickup('ga_strawbery')
      }
    },
    {
      label: 'Bring it to Cosmo',
      run: async ctx => {
        await ctx.trigger('cosmo_2')
      }
    }
  ],

  finishMessage: 'Done! Cosmo has his strawberry.'
}
