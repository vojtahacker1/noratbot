const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'servers',
    description: 'List all bots with status and player count',
    roleRequired: 'Public',
    aliases: ["ss"],

    async execute(msg, args, client, bot) {
        const pool = [...global.channelMap.values()];
        if (!pool.length) return 'No bots online.';

        const fields = pool.map(b => {
            const online = b.ready ? 'Online' : 'Offline';
            const host = b.config?.host || '?';
            const port = b.config?.port || '?';

            let count = 0;
            if (b.playersAPI?.getOnline) {
                const list = b.playersAPI.getOnline();
                if (list) count = list.length;
            } else if (b.players) {
                const tmp = Object.values(b.players).filter(p => p?.uuid);
                count = tmp.length;
            }

            return {
                name: `[${b.id}] ${host}:${port}`,
                value: `${online} - ${count} players`,
                inline: false
            };
        });

        return {
            embed: new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle('Servers')
                .addFields(fields)
                .setTimestamp()
        };
    }
};