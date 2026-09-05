const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'cb',
    description: 'Run a command through command block (server or current)',
    roleRequired: 'Public',

    async execute(msg, args, client, bot) {
        if (!args.length) return '!cb <server> <cmd> or !cb <cmd> (if channel is linked)';

        const allBots = [...global.channelMap.values()];
        let target = bot;
        let cmd = args.join(' ');
        let srv = null;
        const maybeServer = args[0].toLowerCase();
        const found = allBots.find(b => b.id === maybeServer);
        if (found) {
            target = found;
            srv = maybeServer;
            cmd = args.slice(1).join(' ');
            if (!cmd) return `Usage: !cb ${maybeServer} <command>`;
        } else {
            if (!target) return 'No bot linked to this channel. Use !cb <server> <command>';
            srv = target.id;
        }

        const member = msg.member;
        const gcfg = target.globalConfig?.discord;
        if (!gcfg) return 'Discord config not loaded';

        const hasRole = (id) => id && member.roles.cache.has(id);


        if (!target.core || typeof target.core.run !== 'function') {
            return `Bot "${srv}" core not ready.`;
        }
        try {
            target.core.run(cmd);
            return `Executed on "${srv}": \`${cmd}\``;
        } catch (e) {
            console.error(`[CB] Error on ${srv}:`, e);
            return `Failed on "${srv}". Check logs.`;
        }
    }
};