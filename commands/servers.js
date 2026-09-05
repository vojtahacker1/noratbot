const gradient = require('../utils/gradient');

function grad(text, start, end) {
    return gradient.gradient(text, start, end);
}
function toSNBT(obj) {
    if (typeof obj === 'string') {
        let safeStr = obj.replace(/\n/g, '\\n');
        safeStr = safeStr.replace(/'/g, "\\'");
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
    name: 'servers',
    description: 'List all servers with status and players (click IP to copy)',
    aliases: ["ss"],
    level: 0,

    async execute(ctx) {
        const bots = ctx.bots;
        if (!bots || !bots.size) {
            ctx.tellrawCommand('No bots.');
            return;
        }

        const out = [];
        out.push(...grad('Server list\n', '#f4fcff', '#238bff'));

        for (const [id, b] of bots) {
            const alive = b.ready;
            const host = b.config?.host || '?';
            const port = b.config?.port || '?';
            const ipText = `${host}:${port}`;

            let count = 0;
            if (b.playersAPI?.getOnline) {
                const online = b.playersAPI.getOnline();
                if (online) count = online.length;
            } else if (b.players) {
                const list = Object.values(b.players).filter(p => p?.uuid);
                count = list.length;
            }

            out.push(...grad(`[${id}] `, '#f4fcff', '#238bff'));
            out.push({
                text: ipText + ' ',
                color: alive ? '#62d66b' : '#ff6b6b',
                click_event: {
                    action: 'copy_to_clipboard',
                    value: ipText
                },
                hover_event: {
                    action: 'show_text',
                    value: { text: `Click to copy ${ipText}`, color: 'green' }
                }
            });

            out.push(...grad(`${alive ? 'Online' : 'Offline'} - ${count} players\n`, '#f4fcff', '#238bff'));
        }
        if (out.length && out[out.length - 1].text === '\n') {
            out.pop();
        }
        const rootObject = {
            text: "",
            extra: out
        };
        const commandText = `tellraw @a ${toSNBT(rootObject)}`;
        ctx.run(commandText);
    }
};
