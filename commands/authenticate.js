module.exports = {
    name: 'authenticate',
    description: 'Set a player permission rank (0 public, 1 trusted, 2 admin)',
    aliases: ['auth'],
    level: 2,

    async execute(ctx) {
        const [name, rankText] = ctx.args || [];
        const rank = Number.parseInt(rankText, 10);
        if (!name || !Number.isInteger(rank) || rank < 0 || rank > 2) {
            ctx.tellrawCommand('Usage: authenticate <name> <rank 0|1|2>');
            return;
        }

        const uuid = ctx.bot.commands.getPlayerUUID(name);
        if (!uuid || !ctx.bot.commands.setPlayerLevel(uuid, rank)) {
            ctx.tellrawCommand(`Could not authenticate ${name}.`);
            return;
        }

        const labels = ['public', 'trusted', 'admin'];
        ctx.tellrawCommand(`Authenticated ${name} as ${labels[rank]} (rank ${rank}).`);
    }
};
