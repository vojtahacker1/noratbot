module.exports = {
    name: 'superecho',
    description: 'Broadcast message to all servers',
    level: 1,

    async execute(ctx) {
        const msg = ctx.args.join(' ');
        if (!msg) return ctx.tellrawCommand('Usage: superecho <message>');

        const clean = msg.replace(/&[0-9a-fk-or]/g, '').trim();
        if (!clean) return ctx.tellrawCommand('Message cannot be empty after removing color codes.');

        const all = ctx.bots;
        if (!all || !all.size) return ctx.tellrawCommand('No bots available.');

        let ok = 0, fail = [];

        for (const [id, b] of all) {
            if (b.ready && typeof b.chat === 'function') {
                try {
                    b.chat(clean);
                    ok++;
                } catch (e) {
                    fail.push(`${id}: ${e.message}`);
                }
            } else {
                fail.push(`${id}: not ready`);
            }
        }

        const reply = `Sent to ${ok} server(s)`;
        ctx.tellrawCommand(fail.length ? `${reply} (errors: ${fail.join('; ')})` : reply);
    }
};