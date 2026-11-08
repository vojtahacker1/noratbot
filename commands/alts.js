const gradient = require('../utils/gradient');

const LIMIT = 200;
const ALL_SERVER_FLAGS = ['-allserver', '-allservers'];

const COLORS = {
    primary: '#55aaff',
    secondary: '#62d66b',
    label: '#aaaaaa',
    username: '#d9ffd2',
    number: '#ffaa00'
};

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6 = /^[0-9a-f:]+$/i;

function looksLikeIP(s) {
    return IPV4.test(s) || (s.includes(':') && s.length >= 2 && IPV6.test(s));
}

function timeAgo(ms) {
    const diff = Math.max(0, Date.now() - ms);
    const units = [['y', 31536000000], ['mo', 2592000000], ['d', 86400000], ['h', 3600000], ['m', 60000], ['s', 1000]];
    const parts = [];
    let rest = diff;
    for (const [label, size] of units) {
        const n = Math.floor(rest / size);
        if (n > 0) {
            parts.push(`${n}${label}`);
            rest -= n * size;
        }
        if (parts.length === 2) break;
    }
    return parts.length ? `${parts.join(' ')} ago` : 'just now';
}

function formatDate(ms) {
    return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function stripFormatting(s) {
    return String(s ?? '').replace(/§[0-9a-fk-or]/gi, '').trim();
}

// findPlayerAlts may return a Map, a plain object or an array,
// normalise everything to [{ username, time }]
function normalizeAlts(raw) {
    if (!raw) return [];
    const out = [];

    const pushEntry = (username, value) => {
        let time = 0;
        let server = null;
        if (typeof value === 'number') time = value;
        else if (value && typeof value === 'object') {
            time = Number(value.lastSeen ?? value.time ?? value.left ?? 0) || 0;
            server = value.server ?? value.right ?? null;
        }
        out.push({ username: String(username), time, server });
    };

    if (raw instanceof Map) {
        for (const [k, v] of raw) pushEntry(k, v);
    } else if (Array.isArray(raw)) {
        for (const item of raw) {
            if (typeof item === 'string') pushEntry(item, 0);
            else if (item) pushEntry(item.username ?? item.name, item);
        }
    } else if (typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) pushEntry(k, v);
    }

    return out;
}

module.exports = {
    name: 'alts',
    description: 'Find alts of a player or IP (use -allservers to search every server)',
    aliases: ['findalts', 'sameip'],
    level: 0,

    async execute(ctx) {
        const bot = ctx.bot;
        const args = ctx.args || [];

        const db = bot.playersDatabase;
        if (!db || typeof db.findPlayerAlts !== 'function') {
            return ctx.tellrawCommand('The player database is disabled or not loaded.');
        }

        const allServer = args.some(a => ALL_SERVER_FLAGS.includes(a.toLowerCase()));
        const player = args
            .filter(a => !ALL_SERVER_FLAGS.includes(a.toLowerCase()))
            .join(' ')
            .trim();

        if (!player) {
            return ctx.tellrawCommand('Usage: alts [-allservers] <player|ip>');
        }

        try {
            // prefer the IP of the player if they're online, otherwise ask the database
            const online = bot.playersAPI?.get?.(player);
            let ipFromUsername = online?.ip ?? online?.persistingData?.ip ?? null;
            if (!ipFromUsername && typeof db.getPlayerIP === 'function') {
                ipFromUsername = await db.getPlayerIP(player);
            }

            // only treat the input as an IP if it actually looks like one
            let targetIP = ipFromUsername;
            let isIP = false;
            if (!targetIP) {
                if (!looksLikeIP(player)) {
                    return ctx.tellrawCommand(`No IP known for player ${player}.`);
                }
                targetIP = player;
                isIP = true;
            }

            const raw = await db.findPlayerAlts(targetIP, allServer, LIMIT);
            const alts = normalizeAlts(raw).sort((a, b) => b.time - a.time);

            const header = isIP
                ? `noratbot - Alts of IP ${player} (${alts.length})`
                : `noratbot - Alts of player ${player} (${targetIP}) - ${alts.length} found`;
            const headerComps = gradient.gradient(header, '#f4fcff', '#238bff');

            if (!alts.length) {
                headerComps.push({ text: '\n', color: COLORS.label });
                headerComps.push({ text: 'No alts found.', color: COLORS.label });
                return ctx.tellraw('@a', { text: '', extra: headerComps });
            }

            const onlineNow = new Set(
                (bot.playersAPI?.getOnline?.() || []).map(p => stripFormatting(p.username).toLowerCase())
            );

            const nameComps = alts.flatMap((alt, i) => {
                const name = stripFormatting(alt.username);
                const isOnline = onlineNow.has(name.toLowerCase());
                const seen = isOnline
                    ? 'Online now'
                    : alt.time
                        ? `Last seen ${timeAgo(alt.time)} (${formatDate(alt.time)})`
                        : 'Last seen: unknown';
                const where = alt.server ? `\nServer: ${alt.server}` : '';
                return [{
                    text: name,
                    color: i % 2 === 0 ? COLORS.primary : COLORS.secondary,
                    click_event: { action: 'copy_to_clipboard', value: name },
                    hover_event: {
                        action: 'show_text',
                        value: { text: `Click to copy ${name}\n${seen}${where}`, color: 'green' }
                    }
                }, { text: ' ', color: COLORS.label }];
            });

            // a command block only takes so much text, so send the names in chunks
            const PER_MESSAGE = 40 * 2; // two components (name + space) per alt
            headerComps.push({ text: '\n', color: COLORS.label });
            ctx.tellraw('@a', { text: '', extra: [...headerComps, ...nameComps.slice(0, PER_MESSAGE)] });
            for (let i = PER_MESSAGE; i < nameComps.length; i += PER_MESSAGE) {
                ctx.tellraw('@a', { text: '', extra: nameComps.slice(i, i + PER_MESSAGE) });
            }
        } catch (err) {
            console.error(`[${bot.id}] [alts] Failed:`, err);
            ctx.tellrawCommand('Failed to look up alts.');
        }
    }
};
