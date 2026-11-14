module.exports = {
    name: 'failover',
    description: 'Failover control: status, promote, demote',
    level: 2,
    aliases: ['fo'],
    async execute(ctx) {
        const bot = ctx.bot;
        if (!bot.failover) return ctx.tellrawCommand('Failover not enabled.');
        const sub = (ctx.args && ctx.args[0]) || 'status';
        if (sub === 'promote') {
            bot.failover.promote();
            return ctx.tellrawCommand('Promoted to manager.');
        }
        if (sub === 'demote') {
            bot.failover.demote();
            return ctx.tellrawCommand('Demoted to executor.');
        }
        return ctx.tellrawCommand(`Failover role: ${bot.failover.promoted() ? 'manager' : 'executor'} | lives: ${bot.failover.lives()}`);
    }
};
