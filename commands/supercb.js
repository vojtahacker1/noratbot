module.exports = {
    name: 'supercb',
    description: 'Run command per online player ($uuid, $name, $regex:pattern)',
    level: 1,

    async execute(ctx) {
        const cmd = ctx.args.join(' ');
        if (!cmd) return ctx.tellrawCommand('Usage: supercb <cmd with $uuid, $name, $regex:pattern>');

        const api = ctx.bot.playersAPI;
        if (!api?.getOnline) return ctx.tellrawCommand('Players API not loaded.');

        let players = api.getOnline();
        if (!players?.length) return ctx.tellrawCommand('No players online.');

        let regexPattern = null;
        let cleanedCmd = cmd;
        const regexMatch = cmd.match(/\$regex:([^\s]+)/);
        if (regexMatch) {
            regexPattern = regexMatch[1];
            cleanedCmd = cleanedCmd.replace(/\$regex:[^\s]+/, '').trim();
            try {
                const regex = new RegExp(regexPattern);
                players = players.filter(p => {
                    const name = p.username || p.name || '';
                    return regex.test(name);
                });
                if (!players.length) {
                    ctx.tellrawCommand(`No players match regex: ${regexPattern}`);
                    return;
                }
            } catch (e) {
                ctx.tellrawCommand(`Invalid regex: ${regexPattern} (${e.message})`);
                return;
            }
        }

        let raw = cleanedCmd.replace(/\$all/g, '').trim();
        let hasVars = raw.includes('$uuid') || raw.includes('$name');
        
        if (regexPattern && !hasVars) {
            raw = raw + ' $name';
            hasVars = true;
        }

        if (hasVars) {
            let done = 0;
            for (const p of players) {
                const uuid = p.uuid || 'unknown';
                const name = p.username || p.name || 'unknown';
                ctx.core.run(raw.replace(/\$uuid/g, uuid).replace(/\$name/g, name));
                done++;
            }
            ctx.tellrawCommand(`Executed for ${done} filtered player(s): ${raw}`);
        } else {
            ctx.core.run(raw);
            ctx.tellrawCommand(`Executed: ${raw}`);
        }
    }
};