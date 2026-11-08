// usage: seen <player>
// online players come from the player list, offline ones from the player database

function timeAgo(ms) {
    const diff = Math.max(0, Date.now() - ms);
    const units = [['year', 31536000000], ['month', 2592000000], ['day', 86400000], ['hour', 3600000], ['minute', 60000], ['second', 1000]];
    const parts = [];
    let rest = diff;
    for (const [label, size] of units) {
        const n = Math.floor(rest / size);
        if (n > 0) {
            parts.push(`${n} ${label}${n === 1 ? '' : 's'}`);
            rest -= n * size;
        }
        if (parts.length === 2) break;
    }
    return parts.length ? `${parts.join(' ')} ago` : 'just now';
}

module.exports = {
    name: 'seen',
    description: 'Show when a player was last seen',
    level: 0,

    async execute(ctx) {
        const name = (ctx.args || []).join(' ').trim();
        if (!name) return ctx.tellrawCommand('Usage: seen <player>');

        const bot = ctx.bot;
        const p = bot.playersAPI?.get?.(name);

        if (p && p.online !== false) {
            return ctx.tellrawCommand(`${p.username} is online${p.latency != null ? ` (${p.latency} ms ping)` : ''}.`);
        }

        const saved = bot.playersDatabase?.getPlayerLastSeen?.(name);
        if (saved) {
            const date = new Date(saved.time).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
            return ctx.tellrawCommand(
                `${saved.username} was last seen ${timeAgo(saved.time)} (${date})${saved.server ? ` on ${saved.server}` : ''}.`
            );
        }

        if (p && p.lastSeen) {
            return ctx.tellrawCommand(`${p.username} was last seen ${timeAgo(p.lastSeen)}.`);
        }

        ctx.tellrawCommand(`No record of ${name}.`);
    }
};
