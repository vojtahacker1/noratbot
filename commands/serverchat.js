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
    name: 'serverchat',
    description: 'Send a message to a specific server',
    aliases: ["sc"],
    level: 0,

    async execute(ctx) {
        const args = ctx.args;
        if (args.length < 2) {
            ctx.tellrawCommand('Usage: serverchat <server_id> <message>');
            return;
        }

        const targetId = args[0].toLowerCase();
        const msg = args.slice(1).join(' ');
        if (!msg) {
            ctx.tellrawCommand('Message cannot be empty.');
            return;
        }
        const targetBot = ctx.bots.get(targetId);
        if (!targetBot) {
            const available = [...ctx.bots.keys()].join(', ');
            ctx.tellrawCommand(`Server "${targetId}" not found. Available: ${available || 'none'}`);
            return;
        }
        if (targetBot.id === ctx.bot.id) {
            ctx.tellrawCommand('You cannot send a message to the same server. Use netmsg for all servers or serverchat to another server');
            return;
        }
        if (!targetBot.ready || !targetBot.core || typeof targetBot.core.run !== 'function') {
            ctx.tellrawCommand(`Bot "${targetId}" is not ready or core not available.`);
            return;
        }
        const from = ctx.player.name;
        const host = ctx.bot.config?.host || '?';
        const port = ctx.bot.config?.port || '?';
        const addr = `${host}:${port}`;
        const targetHost = targetBot.config?.host || '?';
        const targetPort = targetBot.config?.port || '?';
        const targetAddr = `${targetHost}:${targetPort}`;

        const extra = [];
        extra.push({
            text: `[${addr} -> ${targetAddr}] `,
            color: '#55aaff',
            click_event: {
                action: 'copy_to_clipboard',
                value: `${addr} -> ${targetAddr}`
            },
            hover_event: {
                action: 'show_text',
                value: {
                    text: `Server Chat\n• From: ${addr}\n• To: ${targetAddr}\n\n» Click to copy route «`,
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
                    text: `Sender: ${from}\nFrom: ${addr}\n\n» Click to copy nickname «`,
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
                        text: `Server Message\n• Length: ${charCount} chars\n\n» Click to copy clean message «`,
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
                    text: `Server Message\n• Length: ${charCount} chars\n\n» Click to copy clean message «`,
                    color: 'gray'
                }
            };
            extra.push(g);
        }

        const rootObject = { text: '', extra };
        const cmd = `tellraw @a ${toSNBT(rootObject)}`;
        try {
            targetBot.core.run(cmd);
            ctx.run(cmd)
        } catch (e) {
            ctx.tellrawCommand(`Failed to send message to ${targetId}: ${e.message}`);
        }
    }
};