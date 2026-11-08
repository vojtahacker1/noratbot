const gradient = require('../utils/gradient');

const PREFIX = 'nr:';

const LEVELS = {
    0: { name: 'Public', color: '#55aaff' },
    1: { name: 'Trusted', color: '#ffaa00' },
    2: { name: 'Admin', color: '#ff6b6b' }
};

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

function levelOf(cmd) {
    return LEVELS[Number(cmd.level)] || { name: `Level ${cmd.level}`, color: '#ffffff' };
}

// commands can set `usage: 'seen <player>'`, otherwise just show the name
function usageOf(cmd) {
    return PREFIX + (cmd.usage || cmd.name);
}

function sendInfo(ctx, cmd) {
    const level = levelOf(cmd);
    const out = [];

    out.push(...grad(`Command Info: ${cmd.name}`, '#f4fcff', '#238bff'));
    out.push({ text: '\n', color: 'gray' });

    out.push({ text: 'Description: ', color: '#62d66b' });
    out.push({ text: cmd.description || 'No description', color: '#ffffff' });
    out.push({ text: '\n', color: 'gray' });

    out.push({ text: 'Usage: ', color: '#62d66b' });
    out.push({ text: usageOf(cmd), color: '#ffffff' });
    out.push({ text: '\n', color: 'gray' });

    out.push({ text: 'Level: ', color: '#62d66b' });
    out.push({ text: `${cmd.level} (${level.name})`, color: level.color });
    out.push({ text: '\n', color: 'gray' });

    if (cmd.aliases && cmd.aliases.length) {
        out.push({ text: 'Aliases: ', color: '#62d66b' });
        out.push({ text: cmd.aliases.join(', '), color: '#ffffff' });
        out.push({ text: '\n', color: 'gray' });
    }

    const suggest = `${PREFIX}${cmd.name} `;
    out.push({ text: '\n» ', color: 'dark_gray' });
    out.push({
        text: 'Click to write command',
        color: '#55aaff',
        click_event: { action: 'suggest_command', command: suggest },
        hover_event: { action: 'show_text', value: { text: `Suggest ${suggest}`, color: 'green' } }
    });

    ctx.run(`tellraw @a ${toSNBT({ text: '', extra: out })}`);
}

function sendList(ctx, onlyLevel) {
    // ctx.commands also holds aliases, so dedupe by name
    const all = [...new Map([...ctx.commands.values()].map(c => [c.name, c])).values()]
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const out = [];
    out.push(...grad('noratbot - Commands', '#f4fcff', '#238bff'));
    out.push({ text: '\n', color: 'gray' });

    for (const lvl of Object.keys(LEVELS).map(Number)) {
        if (onlyLevel !== undefined && lvl !== onlyLevel) continue;

        const cmds = all.filter(c => Number(c.level) === lvl);
        if (!cmds.length) continue;

        out.push({ text: `\n${LEVELS[lvl].name} `, color: LEVELS[lvl].color, bold: true });
        out.push({ text: `(${cmds.length})\n`, color: 'dark_gray' });

        cmds.forEach((cmd, i) => {
            out.push({
                text: cmd.name,
                color: LEVELS[lvl].color,
                click_event: { action: 'suggest_command', command: `${PREFIX}${cmd.name} ` },
                hover_event: {
                    action: 'show_text',
                    value: {
                        text: '',
                        extra: [
                            { text: usageOf(cmd), color: '#ffffff' },
                            { text: `\n${cmd.description || 'No description'}`, color: 'gray' }
                        ]
                    }
                }
            });
            if (i < cmds.length - 1) out.push({ text: ' · ', color: 'dark_gray' });
        });

        out.push({ text: '\n', color: 'gray' });
    }

    out.push({ text: `\nHover for usage. ${PREFIX}help <command> for details`, color: 'dark_gray' });

    ctx.run(`tellraw @a ${toSNBT({ text: '', extra: out })}`);
}

module.exports = {
    name: 'help',
    description: 'List all commands with levels',
    usage: 'help [command|public|trusted|admin]',
    level: 0,

    async execute(ctx) {
        const args = ctx.args || [];

        if (args.length === 0) {
            sendList(ctx);
            return;
        }

        const search = args[0].toLowerCase();

        const cmd = ctx.commands.get(search);
        if (cmd) {
            sendInfo(ctx, cmd);
            return;
        }

        const level = Object.keys(LEVELS).find(n => LEVELS[n].name.toLowerCase() === search);
        if (level !== undefined) {
            sendList(ctx, Number(level));
            return;
        }

        ctx.tellrawCommand(`Command "${search}" not found.`);
    }
};