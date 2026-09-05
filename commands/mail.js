module.exports = {
    name: 'mail',
    description: 'Mail system: send, read, clear, list',
    level: 0,

    async execute(ctx) {
        const args = ctx.args;
        if (!args.length) {
            ctx.tellrawCommand('Usage: mail <send|read|clear|list> [params]');
            return;
        }

        const sub = args[0].toLowerCase();
        const mail = ctx.bot.mail;
        if (!mail || typeof mail.send !== 'function') {
            ctx.tellrawCommand('Mail plugin not loaded.');
            return;
        }

        const playerName = ctx.player.name;

        if (sub === 'send') {
            if (args.length < 3) {
                ctx.tellrawCommand('Usage: mail send <player> <message>');
                return;
            }
            const to = args[1];
            const text = args.slice(2).join(' ');
            const success = mail.send(playerName, to, text);
            if (success) {
                ctx.tellrawCommand(`Message sent to ${to}.`);
            } else {
                ctx.tellrawCommand('Failed to send message.');
            }
            return;
        }

        if (sub === 'read') {
            const unread = mail.getUnread(playerName);
            if (!unread.length) {
                ctx.tellrawCommand('No unread messages.');
                return;
            }
            const lines = unread.map((m, i) => {
                const date = new Date(m.time).toLocaleString();
                return `[${i+1}] From ${m.from} (${date}): ${m.text}`;
            });
            ctx.tellrawCommand(`Unread messages:\n${lines.join('\n')}`);
            mail.markRead(playerName);
            return;
        }

        if (sub === 'clear') {
            const onlyRead = args[1] !== 'all';
            const success = mail.clear(playerName, onlyRead);
            if (success) {
                ctx.tellrawCommand(`Cleared ${onlyRead ? 'read' : 'all'} messages.`);
            } else {
                ctx.tellrawCommand('No messages to clear.');
            }
            return;
        }

        if (sub === 'list') {
            const all = mail.getPlayerMails(playerName);
            if (!all.length) {
                ctx.tellrawCommand('No messages.');
                return;
            }
            const lines = all.map((m, i) => {
                const date = new Date(m.time).toLocaleString();
                const status = m.read ? 'Read' : 'Unread';
                return `[${i+1}] ${status} | From ${m.from} (${date}): ${m.text}`;
            });
            ctx.tellrawCommand(`Your messages:\n${lines.join('\n')}`);
            return;
        }

        ctx.tellrawCommand('Usage: mail <send|read|clear|list> [params]');
    }
};