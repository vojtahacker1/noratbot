const shutdown = require('../utils/shutdown');

module.exports = {
    name: 'restart',
    description: 'Refresh command files, or "restart force" to fully restart the process (admin only)',
    usage: 'restart [botid|all|force]',
    level: 2,
    async execute(ctx) {
        const first = String(ctx.args?.[0] || '').toLowerCase();

        if (first === 'force') {
            ctx.tellrawCommand('Force restarting the whole process...');
            shutdown(ctx, true);
            return;
        }

        const manager = ctx.bot.manager;
        if (typeof ctx.bot.commands?.reload !== 'function') return ctx.tellrawCommand('Command handler is unavailable.');
        const requested = String(ctx.args?.[0] || ctx.bot.id).toLowerCase();
        const bots = requested === 'all'
            ? (manager?.list?.() || [ctx.bot])
            : [manager?.get?.(requested)].filter(Boolean);
        if (!bots.length) return ctx.tellrawCommand(`Unknown bot "${requested}".`);
        for (const target of bots) {
            if (typeof target.commands?.reload !== 'function') {
                return ctx.tellrawCommand(`Command handler unavailable for ${target.id}.`);
            }
            target.commands.reload();
        }
        ctx.tellrawCommand(`Refreshed commands for ${bots.map(target => target.id).join(', ')}.`);
    }
};