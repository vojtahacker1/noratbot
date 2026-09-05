const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'filter',
    description: 'Manage filter (players, UUIDs, regex)',
    aliases: ["f"],
    level: 1,

    async execute(ctx) {
        const args = ctx.args;
        if (!args.length) {
            ctx.tellrawCommand('Usage: filter <list|add|remove|add-uuid|remove-uuid|clear|clear-uuid|regex> ...');
            return;
        }

        const f = ctx.bot.filter;
        if (!f || typeof f.addPlayer !== 'function') {
            ctx.tellrawCommand('Filter plugin not loaded.');
            return;
        }

        const sub = args[0].toLowerCase();
        const rest = args.slice(1);
        const say = ctx.tellrawCommand.bind(ctx);

        const isUuid = s =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ||
            /^[0-9a-f]{32}$/i.test(s);

        if (sub === 'list') {
            const players = f.listPlayers() || [];
            const uuids = f.listUUIDs() || [];
            const regex = f.getRegex();
            say(`Players: ${players.length ? players.join(', ') : '(empty)'}\nUUIDs: ${uuids.length ? uuids.join(', ') : '(empty)'}\nRegex: ${regex || '(none)'}`);
            return;
        }

        if (sub === 'add') {
            if (!rest.length) return say('Usage: filter add <name or UUID>');
            const val = rest.join(' ');
            let ok;
            if (isUuid(val)) {
                ok = f.addUUID(val);
                say(ok ? `Added UUID "${val}" to filter list` : `Failed to add UUID to filter list (maybe exists)`);
            } else {
                ok = f.addPlayer(val);
                say(ok ? `Added player "${val}" to filter list` : `Failed to add player to filter list (maybe exists)`);
            }
            return;
        }

        if (sub === 'remove') {
            if (!rest.length) return say('Usage: filter remove <name or UUID>');
            const val = rest.join(' ');
            let ok = false;
            if (isUuid(val)) {
                ok = f.removeUUID(val);
            } else {
                ok = f.removePlayer(val);
                if (!ok) ok = f.removeUUID(val);
            }
            say(ok ? `Removed "${val}" from filter list` : `Failed to remove "${val}" from filter list (not found)`);
            return;
        }

        if (sub === 'add-uuid') {
            if (!rest.length) return say('Usage: filter add-uuid <uuid>');
            const val = rest.join(' ');
            const ok = f.addUUID(val);
            say(ok ? `Added UUID "${val}" to filter list` : `Failed to add UUID to filter list (maybe exists)`);
            return;
        }

        if (sub === 'remove-uuid') {
            if (!rest.length) return say('Usage: filter remove-uuid <uuid>');
            const val = rest.join(' ');
            const ok = f.removeUUID(val);
            say(ok ? `Removed UUID "${val}" to filter list` : `Failed to remove UUID from filter list (not found)`);
            return;
        }

        if (sub === 'clear') {
            const ok = f.clearPlayers();
            say(ok ? 'Cleared all player names from filter list' : 'Failed to clear players from filter list');
            return;
        }

        if (sub === 'clear-uuid') {
            const ok = f.clearUUIDs();
            say(ok ? 'Cleared all UUIDs from filter list' : 'Failed to clear UUIDs from filter list');
            return;
        }

        if (sub === 'regex') {
            if (!rest.length) return say('Usage: filter regex <set|get|remove> [pattern]');
            const rsub = rest[0].toLowerCase();
            const rval = rest.slice(1).join(' ');
            if (rsub === 'set') {
                if (!rval) return say('Usage: filter regex set <pattern>');
                const ok = f.setRegex(rval);
                say(ok ? `Set regex: ${rval} to filter list` : `Failed to set regex (invalid pattern) in filter list`);
            } else if (rsub === 'get' || rsub === 'list') {
                say(`Current regex: ${f.getRegex() || '(none)'} in filter list`);
            } else if (rsub === 'remove' || rsub === 'clear') {
                const ok = f.removeRegex();
                say(ok ? 'Removed regex in filter list' : 'Failed to remove regex from filter list');
            } else {
                say('Usage: filter regex <set|get|remove> [pattern]');
            }
            return;
        }

        say(`Unknown subcommand: ${sub}. Available: list, add, remove, add-uuid, remove-uuid, clear, clear-uuid, regex`);
    }
};