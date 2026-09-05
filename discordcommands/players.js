const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'players',
    desc: 'List online players and their uuids on given server',
    roleRequired: 'Public',
    aliases: ["list"],

    async execute(msg, args) {
        const all = [...global.channelMap.values()];
        if (!all.length) return 'No bots available.';

        let target = null;
        let srv = null;

        if (args.length) {
            const id = args[0].toLowerCase();
            const found = all.find(b => b.id === id);
            if (!found) return `Server "${id}" not found. Available: ${all.map(b => b.id).join(', ')}`;
            target = found;
            srv = id;
        } else {
            const linked = global.channelMap.get(msg.channel.id);
            if (!linked) return 'No server specified and no linked bot. Use !players <server>';
            target = linked;
            srv = target.id;
        }

        const api = target.playersAPI;
        if (!api || typeof api.getOnline !== 'function') return `Players API not loaded on "${srv}".`;

        const online = api.getOnline();
        if (!online || !online.length) return `No players online on "${srv}".`;

        const lines = online.map(p => {
            const name = (p.username || 'unknown').replace(/\u00A7[0-9a-fk-or]/g, '');
            const uuid = p.uuid || 'no uuid';
            return `${name} - ${uuid}`;
        }).join('\n');

        return {
            embed: new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle(`Players on ${srv}`)
                .setDescription(`\`\`\`\n${lines}\n\`\`\``)
                .setFooter({ text: `Total: ${online.length}` })
                .setTimestamp()
        };
    }
};