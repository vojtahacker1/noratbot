module.exports = {
    name: 'echo',
    description: 'Make the bot say something',
    level: 0,

    async execute(ctx) {
        const msg = ctx.args.join(' ');
        if (!msg) return;
        ctx.bot.chat(msg);
    }
};