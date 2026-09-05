const crypto = require('crypto');

module.exports = function validator(bot) {
    const cfg = bot.globalConfig?.bot || {};
    const tKey = cfg.trustedKey;
    const aKey = cfg.adminKey;

    if (!tKey && !aKey) {
        console.log(`[${bot.id}] [Validate] No keys, disabled`);
        return;
    }

    const used = new Map();

    const hash8 = (key, offset = 0) => {
        const time = Math.floor(Date.now() / 10000) + offset;
        return crypto.createHash('sha256').update(key + time).digest('hex').slice(0, 8);
    };

    const hash16 = (key, offset = 0) => {
        const time = Math.floor(Date.now() / 1000) + offset;
        return crypto.createHash('sha256').update(time + key).digest('hex').slice(0, 16);
    };

    const check = (hash, key) => {
        if (!key || !hash) return false;
        if (hash.length === 8) {
            for (let off = -2; off <= 2; off++) {
                if (hash8(key, off) === hash) return true;
            }
        } else if (hash.length === 16) {
            for (let off = -5; off <= 5; off++) {
                if (hash16(key, off) === hash) return true;
            }
        }
        return false;
    };

    const parse = (raw) => {
        if (!raw || typeof raw !== 'string' || raw.trim().startsWith('/')) return null;
        const clean = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (!clean) return null;

        const prefixes = Array.isArray(bot.globalConfig?.bot?.prefix) 
            ? bot.globalConfig.bot.prefix 
            : (bot.globalConfig?.bot?.prefix ? [bot.globalConfig.bot.prefix] : ['nr:']);
        let rest = null;
        for (const p of prefixes) {
            const idx = clean.toLowerCase().indexOf(p.toLowerCase());
            if (idx !== -1) {
                rest = clean.slice(idx + p.length);
                break;
            }
        }
        if (!rest) return null;

        const parts = rest.split(/\s+/);
        if (parts.length < 2) return null;

        const cmd = parts[0];
        const hash = parts[1];
        const args = parts.slice(2);

        if (used.has(hash)) return null;

        let level = null;
        if (tKey && check(hash, tKey)) level = 'trusted';
        else if (aKey && check(hash, aKey)) level = 'admin';
        if (!level) return null;

        used.set(hash, Date.now());
        setTimeout(() => used.delete(hash), 5000);

        return { command: cmd, args, raw: rest, hash, level, full: clean };
    };

    setInterval(() => {
        const now = Date.now();
        for (const [k, ts] of used) {
            if (now - ts > 5000) used.delete(k);
        }
    }, 5000);

    bot.generateHash8 = hash8;
    bot.generateHash16 = hash16;
    bot.verifyHash = check;
    bot.validateCommand = parse;

    bot.on('chat_plain', msg => {
        const res = parse(msg);
        if (res) bot.emit('validated_command', res);
    });
};