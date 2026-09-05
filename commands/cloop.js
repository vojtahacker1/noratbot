module.exports = {
    name: 'cloop',
    description: 'Manage command loops on this server',
    level: 1,

    async execute(ctx) {
        const args = ctx.args;
        if (!args.length) return ctx.tellrawCommand('Usage: cloop <add|remove|list|clear> ...');

        const sub = args[0].toLowerCase();
        const rest = args.slice(1);

        const cl = ctx.bot.cloops;
        if (!cl || typeof cl.add !== 'function') {
            return ctx.tellrawCommand('Cloop plugin not loaded.');
        }

        const srv = ctx.bot.id;
        const say = ctx.tellrawCommand.bind(ctx);

        if (sub === 'add') {
            if (rest.length < 2) return say('Usage: cloop add <ms> <cmd>');
            const ms = parseInt(rest[0]);
            if (isNaN(ms) || ms <= 0) return say('Interval must be positive number.');
            const cmd = rest.slice(1).join(' ');
            if (!cmd) return say('Command cannot be empty.');
            if (cl.add(srv, ms, cmd)) {
                const list = cl.list(srv);
                const id = list.length ? list[list.length - 1].id : 0;
                say(`Added cloop: "${cmd}" every ${ms}ms (ID: ${id})`);
            } else {
                say('Failed to add cloop.');
            }
            return;
        }

        if (sub === 'remove') {
            if (!rest.length) return say('Usage: cloop remove <id>');
            const id = parseInt(rest[0]);
            if (isNaN(id)) return say('ID must be a number.');
            const list = cl.list(srv);
            if (!list.find(i => i.id === id)) return say(`No cloop with ID ${id}.`);
            if (cl.remove(srv, id)) say(`Removed cloop ID ${id}.`);
            else say(`Failed to remove cloop ID ${id}.`);
            return;
        }

        if (sub === 'list') {
            const list = cl.list(srv);
            if (!list.length) return say('No cloops.');
            const lines = list.map(i => `ID ${i.id}: ${i.interval}ms → ${i.command}`);
            say('Cloops:\n' + lines.join('\n'));
            return;
        }

        if (sub === 'clear') {
            const list = cl.list(srv);
            if (!list.length) return say('No cloops to clear.');
            if (cl.clear(srv)) say('Cleared all cloops.');
            else say('Failed to clear cloops.');
            return;
        }

        say('Usage: cloop <add|remove|list|clear> ...');
    }
};