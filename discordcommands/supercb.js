const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'supercb',
    description: 'Run command per player ($uuid, $name, $regex:pattern) on server(s)',
    roleRequired: 'Trusted',

    async execute(msg, args, client, bot) {
        const pool = [...global.channelMap.values()];
        if (!pool.length) return 'No bots.';

        const gcfg = pool[0]?.globalConfig?.discord;
        if (!gcfg) return 'Discord config missing.';

        const member = msg.member;
        if (!member) return 'Not in server.';
        const hasTrusted = gcfg.trustedId && member.roles.cache.has(gcfg.trustedId);
        const hasAdmin = gcfg.adminId && member.roles.cache.has(gcfg.adminId);
        if (!hasTrusted && !hasAdmin) return 'Trusted or Admin required.';

        const target = args[0]?.toLowerCase();
        if (!target) return '!supercb <server|all> <command>';

        const rawCmd = args.slice(1).join(' ');
        if (!rawCmd) return '!supercb <server|all> <command with $uuid, $name, $regex:pattern>';

        let regexPattern = null;
        let cleanedCmd = rawCmd;
        const regexMatch = rawCmd.match(/\$regex:([^\s]+)/);
        if (regexMatch) {
            regexPattern = regexMatch[1];
            cleanedCmd = cleanedCmd.replace(/\$regex:[^\s]+/, '').trim();
            try {
                new RegExp(regexPattern);
            } catch (e) {
                return `Invalid regex: ${regexPattern} (${e.message})`;
            }
        }

        const runOn = async (botInstance, id) => {
            const api = botInstance.playersAPI;
            if (!api?.getOnline) return { id, err: 'Players API missing', results: [] };

            let players = api.getOnline();
            if (!players?.length) return { id, err: 'No players online', results: [] };

            if (regexPattern) {
                try {
                    const regex = new RegExp(regexPattern);
                    players = players.filter(p => {
                        const name = p.username || p.name || '';
                        return regex.test(name);
                    });
                    if (!players.length) {
                        return { id, err: `No players match regex: ${regexPattern}`, results: [] };
                    }
                } catch (e) {
                    return { id, err: `Invalid regex: ${regexPattern} (${e.message})`, results: [] };
                }
            }

            let cmd = cleanedCmd.replace(/\$all/g, '').trim();
            let hasVars = cmd.includes('$uuid') || cmd.includes('$name');
            
            if (regexPattern && !hasVars) {
                cmd = cmd + ' $name';
                hasVars = true;
            }

            const results = [];

            if (hasVars) {
                for (const p of players) {
                    const uuid = p.uuid || 'unknown';
                    const name = p.username || p.name || 'unknown';
                    const full = cmd.replace(/\$uuid/g, uuid).replace(/\$name/g, name);
                    try {
                        botInstance.core.run(full);
                        results.push(`${name} (${uuid}): \`${full}\``);
                    } catch (e) {
                        results.push(`${name}: ${e.message}`);
                    }
                }
            } else {
                try {
                    botInstance.core.run(cmd);
                    results.push(`Executed: \`${cmd}\``);
                } catch (e) {
                    results.push(`Error: ${e.message}`);
                }
            }

            return { id, players, results, cmd };
        };

        if (target === 'all') {
            const all = [];
            for (const b of pool) {
                all.push(await runOn(b, b.id));
            }
            const embed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle('SuperCB on all servers')
                .setDescription(`Command: \`${cleanedCmd}\`${regexPattern ? `\nFilter: \`${regexPattern}\`` : ''}`)
                .setTimestamp();

            for (const res of all) {
                if (res.err) {
                    embed.addFields({ name: `[${res.id}]`, value: res.err, inline: false });
                } else {
                    embed.addFields({
                        name: `[${res.id}] (${res.players?.length || 0} players)`,
                        value: res.results.join('\n') || 'no results',
                        inline: false
                    });
                }
            }
            return { embed };
        }

        const targetBot = pool.find(b => b.id === target);
        if (!targetBot) return `Server "${target}" not found. Available: ${pool.map(b => b.id).join(', ')}`;
        if (!targetBot.core?.run) return `Core not ready on "${target}".`;

        const res = await runOn(targetBot, target);
        if (res.err) return res.err;

        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle(`SuperCB on ${target}`)
            .setDescription(`Executed for ${res.players?.length || 0} player(s)\nCommand: \`${res.cmd}\`${regexPattern ? `\nFilter: \`${regexPattern}\`` : ''}`)
            .addFields(
                { name: 'Players', value: (res.players || []).map(p => `${p.username} (${p.uuid || 'no uuid'})`).join('\n') || 'None', inline: false },
                { name: 'Results', value: res.results.join('\n') || 'No results', inline: false }
            )
            .setTimestamp();

        return { embed };
    }
};