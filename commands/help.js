const gradient = require('../utils/gradient');

function grad(text, start, end) {
    return gradient.gradient(text, start, end);
}

function toSNBT(obj) {
    if (typeof obj === 'string') {
        let safeStr = obj.replace(/\n/g, '\\n').replace(/'/g, "\\'");
        return `'${safeStr}'`;
    }
    if (typeof obj === 'number' || typeof obj === 'boolean') {
        return obj.toString();
    }
    if (Array.isArray(obj)) {
        return `[${obj.map(item => toSNBT(item)).join(',')}]`;
    }
    if (typeof obj === 'object' && obj !== null) {
        const pairs = [];
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                pairs.push(`${key}:${toSNBT(obj[key])}`);
            }
        }
        return `{${pairs.join(',')}}`;
    }
    return "''";
}

module.exports = {
    name: 'help',
    description: 'List all commands with levels',
    level: 0,

    async execute(ctx) {
        const args = ctx.args || [];
        const prefix = 'nr:';

        if (args.length > 0) {
            const searchName = args[0].toLowerCase();
            const foundCmd = ctx.commands.get(searchName);

            if (!foundCmd) {
                ctx.tellrawCommand(`Command "${searchName}" not found.`);
                return;
            }

            const infoComponents = [];
            infoComponents.push(...grad(`Command Info: ${foundCmd.name}`, '#f4fcff', '#238bff'));
            infoComponents.push({ text: '\n', color: 'gray' });

            infoComponents.push({ text: 'Description: ', color: '#62d66b' });
            infoComponents.push({ text: foundCmd.description || 'No description', color: '#ffffff' });
            infoComponents.push({ text: '\n', color: 'gray' });

            let levelName = 'Public';
            if (foundCmd.level === 1) levelName = 'Trusted';
            else if (foundCmd.level === 2) levelName = 'Admin';
            infoComponents.push({ text: 'Level: ', color: '#62d66b' });
            infoComponents.push({ text: `${foundCmd.level} (${levelName})`, color: '#55aaff' });
            infoComponents.push({ text: '\n', color: 'gray' });

            if (foundCmd.aliases && foundCmd.aliases.length) {
                infoComponents.push({ text: 'Aliases: ', color: '#62d66b' });
                infoComponents.push({ text: foundCmd.aliases.join(', '), color: '#ffffff' });
                infoComponents.push({ text: '\n', color: 'gray' });
            }

            const runText = `${prefix}${foundCmd.name}`;
            infoComponents.push({ text: '\n» ', color: 'dark_gray' });
            infoComponents.push({
                text: 'Click to write command',
                color: '#55aaff',
                click_event: { action: 'suggest_command', command: runText },
                hover_event: { action: 'show_text', value: { text: `Suggest ${runText}`, color: 'green' } }
            });

            const rootInfo = { text: '', extra: infoComponents };
            ctx.run(`tellraw @a ${toSNBT(rootInfo)}`);
            return;
        }

        const all = [...new Map([...ctx.commands.values()].map(c => [c.name, c])).values()];
        const sorted = all.sort((a, b) => {
            if (Number(a.level) !== Number(b.level)) return Number(a.level) - Number(b.level);
            return String(a.name).localeCompare(String(b.name));
        });

        const components = [];
        components.push(...grad('noratbot - Commands', '#f4fcff', '#238bff'));
        components.push({ text: '\n\n', color: 'gray' });
        const levelColors = {
            0: '#55aaff',
            1: '#ffaa00',
            2: '#ff6b6b' 
        };
        const levelNames = {
            0: 'Public',
            1: 'Trusted',
            2: 'Admin'
        };

        for (let i = 0; i < sorted.length; i++) {
            const cmd = sorted[i];
            const cmdText = `${prefix}${cmd.name}`;
            const color = levelColors[cmd.level] || '#ffffff';

            components.push({
                text: cmd.name,
                color: color,
                click_event: { action: 'suggest_command', command: cmdText }
            });

            if (i < sorted.length - 1) {
                components.push({ text: ' ', color: 'gray' });
            }
        }

        const rootObject = { text: '', extra: components };
        ctx.run(`tellraw @a ${toSNBT(rootObject)}`);
    }
};