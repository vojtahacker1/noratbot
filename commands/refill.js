module.exports = {
    name: 'refill',
    description: 'Refills the core area',
    level: 0,

    async execute(ctx) {
        ctx.bot.core.refill('initial');
    }
};