module.exports = {
    name: 'whitelist',
    description: 'Manage whitelist (on/off, add/remove players)',
    aliases: ['wl'],
    level: 1,

    async execute(ctx) {
        const args = ctx.args || [];
        const w = ctx.bot?.whitelist;
        if (!w || typeof w.addPlayer !== 'function') {
            ctx.tellrawCommand('Whitelist plugin not loaded.');
            return;
        }

        const sub = (args[0] || '').toLowerCase();
        const rest = args.slice(1);
        const say = ctx.tellrawCommand.bind(ctx);

        const isUuid = s =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ||
            /^[0-9a-f]{32}$/i.test(s);
        const isIp = s => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);

        if (!sub) {
            say('Usage: whitelist <on|off|add|remove|list|clear> [player]');
            return;
        }

        if (sub === 'on') {
            const ok = w.on();
            say(ok ? 'Whitelist enabled.' : 'Failed to enable whitelist.');
            return;
        }

        if (sub === 'off') {
            const ok = w.off();
            say(ok ? 'Whitelist disabled.' : 'Failed to disable whitelist.');
            return;
        }

        if (sub === 'list') {
            const players = w.listPlayers() || [];
            const uuids = w.listUUIDs() || [];
            const ips = w.listIPs() || [];
            say(`Whitelist ${w.isEnabled() ? 'ON' : 'OFF'}\nPlayers: ${players.length ? players.join(', ') : '(empty)'}\nUUIDs: ${uuids.length ? uuids.join(', ') : '(empty)'}\nIPs: ${ips.length ? ips.join(', ') : '(empty)'}`);
            return;
        }

        if (sub === 'clear') {
            w.clearPlayers();
            w.clearUUIDs();
            w.clearIPs();
            say('Cleared whitelist.');
            return;
        }

        if (sub === 'add') {
            if (!rest.length) return say('Usage: whitelist add <player>');
            const val = rest.join(' ');
            let ok;
            if (isUuid(val)) ok = w.addUUID(val);
            else if (isIp(val)) ok = w.addIP(val);
            else ok = w.addPlayer(val);
            say(ok ? `Added \"${val}\" to whitelist.` : `Failed to add \"${val}\" (maybe exists).`);
            return;
        }

        if (sub === 'remove') {
            if (!rest.length) return say('Usage: whitelist remove <player>');
            const val = rest.join(' ');
            let ok = false;
            if (isUuid(val)) ok = w.removeUUID(val);
            else if (isIp(val)) ok = w.removeIP(val);
            else {
                ok = w.removePlayer(val);
                if (!ok) ok = w.removeUUID(val);
                if (!ok) ok = w.removeIP(val);
            }
            say(ok ? `Removed \"${val}\" from whitelist.` : `Failed to remove \"${val}\" (not found).`);
            return;
        }

        say(`Unknown subcommand: ${sub}. Available: on, off, add, remove, list, clear`);
    }
};
