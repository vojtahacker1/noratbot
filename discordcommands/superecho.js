const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'superecho',
    description: 'Broadcast message as bot to server(s)',
    roleRequired: 'Trusted',

    async execute(msg, args, client, bot) {
        const all = [...global.channelMap.values()];
        if (!all.length) return 'No bots.';

        const gcfg = all[0]?.globalConfig?.discord;
        if (!gcfg) return 'Discord config missing.';

        const member = msg.member;
        if (!member) return 'Not in server.';
        const trusted = gcfg.trustedId && member.roles.cache.has(gcfg.trustedId);
        const admin = gcfg.adminId && member.roles.cache.has(gcfg.adminId);
        if (!trusted && !admin) return 'Trusted or Admin required.';

        let targets = [];
        let text = '';

        const maybe = args[0]?.toLowerCase();
        if (maybe === 'all') {
            targets = all;
            text = args.slice(1).join(' ');
        } else {
            const found = all.find(b => b.id === maybe);
            if (found) {
                targets = [found];
                text = args.slice(1).join(' ');
            } else {
                targets = all;
                text = args.join(' ');
            }
        }

        if (!text) {
            return 'Usage: !superecho <server|all> <message> or !superecho <message> (broadcasts to all)';
        }

        const clean = text.replace(/&[0-9a-fk-or]/g, '').trim();
        if (!clean) return 'Message cannot be empty after removing color codes.';

        let ok = 0;
        const errors = [];

        for (const b of targets) {
            if (!b.ready) {
                errors.push(`${b.id}: not ready`);
                continue;
            }
            try {
                if (typeof b.chat === 'function') {
                    b.chat(clean);
                    ok++;
                } else {
                    errors.push(`${b.id}: no chat method`);
                }
            } catch (e) {
                errors.push(`${b.id}: ${e.message}`);
            }
        }

        const embed = new EmbedBuilder()
            .setColor(ok > 0 ? 0x00ff00 : 0xff0000)
            .setTitle('SuperEcho')
            .setDescription(`Sent to ${ok} server(s)`)
            .addFields(
                { name: 'Message', value: `\`${clean}\``, inline: false },
                { name: 'Targets', value: targets.map(b => b.id).join(', ') || 'none', inline: false }
            )
            .setTimestamp();

        if (errors.length) {
            embed.addFields({ name: 'Errors', value: errors.join('\n'), inline: false });
        }

        return { embed };
    }
};