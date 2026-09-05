const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'help',
    description: 'List all discord commands with roles',

    async execute(msg, args, client, bot) {
        let target = bot;
        if (!target) {
            const pool = global.channelMap ? [...global.channelMap.values()] : [];
            if (!pool.length) return 'No bots available.';
            target = pool[0];
        }

        const gconf = target.globalConfig?.discord;
        if (!gconf) return 'Discord config missing.';

        const member = msg.member;
        if (!member) return 'Not in a server.';

        const hasTrusted = gconf.trustedId && member.roles.cache.has(gconf.trustedId);
        const hasAdmin = gconf.adminId && member.roles.cache.has(gconf.adminId);

        const all = global.discordCommands;
        if (!all || all.size === 0) return 'No commands loaded.';

        const cmds = Array.from(all.entries()).map(([name, cmd]) => ({
            name,
            desc: cmd.description || 'No description',
            role: cmd.roleRequired || 'Public'
        })).sort((a, b) => a.name.localeCompare(b.name));

        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('Discord Commands')
            .setDescription(`Prefix: ${global.commandPrefix || '!'}`)
            .setTimestamp();

        const groups = {
            Public: cmds.filter(c => c.role === 'Public'),
            Trusted: cmds.filter(c => c.role === 'Trusted'),
            Admin: cmds.filter(c => c.role === 'Admin')
        };

        for (const [role, list] of Object.entries(groups)) {
            if (list.length) {
                embed.addFields({
                    name: role,
                    value: list.map(c => `**${c.name}** - ${c.desc}`).join('\n'),
                    inline: false
                });
            }
        }

        let roles = 'Your roles: ';
        if (hasAdmin) roles += 'Admin, ';
        if (hasTrusted) roles += 'Trusted, ';
        if (!hasAdmin && !hasTrusted) roles += 'Public';
        else roles = roles.slice(0, -2);
        embed.setFooter({ text: roles });

        return { embed };
    }
};