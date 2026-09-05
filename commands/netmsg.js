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
    name: 'netmsg',
    description: 'Send a message to all connected servers',
    aliases: ["nm"],
    level: 0,

    async execute(ctx) {
        const args = ctx.args;
        if (!args.length) return;

        const msg = args.join(' ');
        const from = ctx.player.name;
        const host = ctx.bot.config?.host || '?';
        const port = ctx.bot.config?.port || '?';
        const addr = `${host}:${port}`;
        const extra = [];
        extra.push({
            text: `[${addr}] `,
            color: '#55aaff',
            click_event: {
                action: 'copy_to_clipboard',
                value: addr
            },
            hover_event: {
                action: 'show_text',
                value: {
                    text: `Server Info\n\n• Origin: ${addr}\n\n» Click to copy server IP «`,
                    color: 'aqua'
                }
            }
        });

        extra.push({
            text: from,
            color: '#62d66b',
            click_event: {
                action: 'copy_to_clipboard',
                value: from 
            },
            hover_event: {
                action: 'show_text',
                value: {
                    text: `Sender Profile\n\n• Player: ${from}\n• From Server: ${addr}\n\n» Click to copy nickname «`,
                    color: 'green'
                }
            }
        });
        const msgBody = `: ${msg}`;
        const charCount = msg.length;
        const g = grad(msgBody, '#f4fcff', '#238bff');
        if (Array.isArray(g)) {
            for (const letterComponent of g) {
                letterComponent.click_event = {
                    action: 'copy_to_clipboard',
                    value: msg 
                };
                letterComponent.hover_event = {
                    action: 'show_text',
                    value: {
                        text: `Network Message\n• Length: ${charCount} chars\n\n» Click to copy clean message text «`,
                        color: 'gray'
                    }
                };
            }
            extra.push(...g);
        } else {
            g.click_event = { action: 'copy_to_clipboard', value: msg };
            g.hover_event = {
                action: 'show_text',
                value: {
                    text: `Network Message\n• Length: ${charCount} chars\n\n» Click to copy clean message text «`,
                    color: 'gray'
                }
            };
            extra.push(g);
        }
        const rootObject = {
            text: "",
            extra: extra
        };

        const cmd = `tellraw @a ${toSNBT(rootObject)}`;

        let sent = 0;
        for (const [id, bot] of ctx.bots) {
            if (bot.ready && bot.core?.run) {
                try {
                    bot.core.run(cmd);
                    sent++;
                } catch (_) {}
            }
        }
    }
};
