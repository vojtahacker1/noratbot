const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'cloop',
    description: 'Manage command loops (add/remove/list/clear)',
    roleRequired: 'Trusted',

    async execute(msg, args, client, bot) {
        const all = [...global.channelMap.values()];
        if (!all.length) return 'No bots available.';

        const first = all[0];
        const gcfg = first.globalConfig?.discord;
        if (!gcfg) return 'Discord config not loaded';

        const member = msg.member;
        if (!member) return 'Not in a server.';

        const trusted = gcfg.trustedId && member.roles.cache.has(gcfg.trustedId);
        const admin = gcfg.adminId && member.roles.cache.has(gcfg.adminId);
        if (!trusted && !admin) return 'Trusted or Admin role required.';

        const sub = args[0]?.toLowerCase();
        const srv = args[1]?.toLowerCase();
        const p1 = args[2];
        const p2 = args.slice(3).join(' ');

        const target = all.find(b => b.id === srv);
        if (!target) return `Server "${srv}" not found. Available: ${all.map(b => b.id).join(', ')}`;
        if (!target.cloops || typeof target.cloops.add !== 'function') {
            return `Cloop plugin not loaded for "${srv}".`;
        }

        const tellMC = (text) => {
            if (target.core && typeof target.core.run === 'function') {
                try {
                    const grad = require('../utils/gradient');
                    const comps = grad.gradient(`noratbot - ${text}`, '#f4fcff', '#238bff');
                    target.core.run(`tellraw @a ${JSON.stringify(comps)}`);
                } catch (_) {}
            }
        };

        if (sub === 'add') {
            if (!srv || !p1 || !p2) return 'Usage: cloop add <server> <interval_ms> <command>';
            const interval = parseInt(p1);
            if (isNaN(interval) || interval <= 0) return 'Interval must be positive (ms).';
            const cmd = p2.trim();
            if (!cmd) return 'Command cannot be empty.';
            const ok = target.cloops.add(srv, interval, cmd);
            if (ok) {
                const id = target.cloops.list(srv).length - 1;
                const msg = `Added cloop on ${srv}: "${cmd}" every ${interval}ms (ID: ${id})`;
                tellMC(msg);
                return msg;
            }
            return 'Failed to add cloop.';
        }

        if (sub === 'remove') {
            if (!srv || !p1) return 'Usage: cloop remove <server> <id>';
            const id = parseInt(p1);
            if (isNaN(id)) return 'ID must be a number.';
            const list = target.cloops.list(srv);
            if (!list.find(i => i.id === id)) return `No cloop with ID ${id} on "${srv}".`;
            const ok = target.cloops.remove(srv, id);
            if (ok) {
                const msg = `Removed cloop ID ${id} on ${srv}`;
                tellMC(msg);
                return msg;
            }
            return `Failed to remove cloop ID ${id}.`;
        }

        if (sub === 'list') {
            if (!srv) return 'Usage: cloop list <server>';
            const list = target.cloops.list(srv);
            if (!list.length) return `No cloop commands on "${srv}".`;
            const fields = list.map(item => ({
                name: `ID ${item.id}`,
                value: `Interval: ${item.interval}ms\nCommand: \`${item.command}\``,
                inline: false
            }));
            return {
                embed: new EmbedBuilder()
                    .setColor(0x0099ff)
                    .setTitle(`Cloops on ${srv}`)
                    .addFields(fields)
                    .setTimestamp()
            };
        }

        if (sub === 'clear') {
            if (!srv) return 'Usage: cloop clear <server>';
            const list = target.cloops.list(srv);
            if (!list.length) return `No cloop commands on "${srv}" to clear.`;
            const ok = target.cloops.clear(srv);
            if (ok) {
                const msg = `Cleared all cloop commands on ${srv}`;
                tellMC(msg);
                return msg;
            }
            return 'Failed to clear cloops.';
        }

        return 'Usage: cloop <add|remove|list|clear> <server> [params]';
    }
};