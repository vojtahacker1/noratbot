const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'filter',
    description: 'Manage filter per server (names, UUIDs, regex)',
    roleRequired: 'Trusted',
    aliases: ["f"],

    async execute(msg, args, client, bot) {
        const connected = [...global.channelMap.values()];
        if (!connected.length) return 'No bots available.';

        const first = connected[0];
        const gcfg = first.globalConfig?.discord;
        if (!gcfg) return 'Discord config not loaded';

        const usr = msg.member;
        if (!usr) return 'Not in a server.';
        const trustedRole = gcfg.trustedId;
        const adminRole = gcfg.adminId;
        const isTrusted = trustedRole && usr.roles.cache.has(trustedRole);
        const isAdmin = adminRole && usr.roles.cache.has(adminRole);
        if (!isTrusted && !isAdmin) return 'Trusted or Admin role required.';

        const action = args[0]?.toLowerCase();
        const srv = args[1]?.toLowerCase();
        const value = args.slice(2).join(' ');

        const target = connected.find(b => b.id === srv);
        if (!target) return `Server "${srv}" not found. Available: ${connected.map(b => b.id).join(', ')}`;
        if (!target.filter || typeof target.filter.addPlayer !== 'function') {
            return `Filter plugin not loaded on "${srv}".`;
        }

        const sendMC = (text) => {
            if (target.core && typeof target.core.run === 'function') {
                try {
                    const grad = require('../utils/gradient');
                    const comps = grad.gradient(`noratbot - ${text}`, '#f4fcff', '#238bff');
                    target.core.run(`tellraw @a ${JSON.stringify(comps)}`);
                } catch (_) {}
            }
        };

        const isUuid = (str) =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str) ||
            /^[0-9a-f]{32}$/i.test(str);

        if (action === 'list') {
            const players = target.filter.listPlayers() || [];
            const uuids = target.filter.listUUIDs() || [];
            const regex = target.filter.getRegex();
            return {
                embed: new EmbedBuilder()
                    .setColor(0x0099ff)
                    .setTitle(`Filter on ${srv}`)
                    .addFields(
                        { name: 'Players', value: players.length ? players.join(', ') : '(empty)', inline: false },
                        { name: 'UUIDs', value: uuids.length ? uuids.join(', ') : '(empty)', inline: false },
                        { name: 'Regex', value: regex || '(none)', inline: false }
                    )
                    .setTimestamp()
            };
        }

        if (action === 'add') {
            if (!value) return 'Usage: filter add <server> <name or UUID>';
            let ok;
            if (isUuid(value)) {
                ok = target.filter.addUUID(value);
                if (ok) sendMC(`Added UUID "${value}" to filter on ${srv}`);
                else return `Failed to add UUID (maybe exists?)`;
            } else {
                ok = target.filter.addPlayer(value);
                if (ok) sendMC(`Added "${value}" (name) to filter on ${srv}`);
                else return `Failed to add "${value}" (maybe exists?)`;
            }
            return ok ? `Added ${isUuid(value) ? 'UUID' : 'player'} "${value}"` : 'Failed.';
        }

        if (action === 'remove') {
            if (!value) return 'Usage: filter remove <server> <name or UUID>';
            let ok = false;
            if (isUuid(value)) {
                ok = target.filter.removeUUID(value);
            } else {
                ok = target.filter.removePlayer(value);
                if (!ok) ok = target.filter.removeUUID(value);
            }
            if (ok) sendMC(`Removed "${value}" from filter on ${srv}`);
            else return `Failed to remove "${value}" (not found?)`;
            return ok ? `Removed "${value}"` : 'Failed.';
        }

        if (action === 'add-uuid') {
            if (!value) return 'Usage: filter add-uuid <server> <uuid>';
            const ok = target.filter.addUUID(value);
            if (ok) sendMC(`Added UUID "${value}" to filter on ${srv}`);
            else return `Failed to add UUID (maybe exists?)`;
            return ok ? `Added UUID "${value}"` : 'Failed.';
        }

        if (action === 'remove-uuid') {
            if (!value) return 'Usage: filter remove-uuid <server> <uuid>';
            const ok = target.filter.removeUUID(value);
            if (ok) sendMC(`Removed UUID "${value}" from filter on ${srv}`);
            else return `Failed to remove UUID (not found?)`;
            return ok ? `Removed UUID "${value}"` : 'Failed.';
        }

        if (action === 'clear') {
            const ok = target.filter.clearPlayers();
            if (ok) sendMC(`Cleared all player names from filter on ${srv}`);
            else return 'Failed to clear players';
            return ok ? 'Cleared players.' : 'Failed.';
        }

        if (action === 'clear-uuid') {
            const ok = target.filter.clearUUIDs();
            if (ok) sendMC(`Cleared all UUIDs from filter on ${srv}`);
            else return 'Failed to clear UUIDs';
            return ok ? 'Cleared UUIDs.' : 'Failed.';
        }

        if (action === 'regex') {
            const sub = args[2]?.toLowerCase();
            const pattern = args.slice(3).join(' ');

            if (sub === 'set') {
                if (!pattern) return 'Usage: filter regex set <server> <pattern>';
                const ok = target.filter.setRegex(pattern);
                if (ok) sendMC(`Set regex filter on ${srv} to: ${pattern}`);
                else return `Failed to set regex (invalid pattern?)`;
                return ok ? `Regex set: ${pattern}` : 'Failed.';
            }

            if (sub === 'get' || !sub) {
                const current = target.filter.getRegex();
                return `Current regex on ${srv}: ${current || '(none)'}`;
            }

            if (sub === 'remove' || sub === 'clear') {
                const ok = target.filter.removeRegex();
                if (ok) sendMC(`Removed regex filter on ${srv}`);
                else return 'Failed to remove regex';
                return ok ? 'Regex removed.' : 'Failed.';
            }

            return 'Usage: filter regex <set|get|remove> <server> [pattern]';
        }

        return `Available: list, add, remove, add-uuid, remove-uuid, clear, clear-uuid, regex set/get/remove`;
    }
};