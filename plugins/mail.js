const fs = require('fs');
const path = require('path');
const gradient = require('../utils/gradient');

const MAIL_FILE = path.join(process.cwd(), 'mails.json');

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

function grad(text, start, end) {
    return gradient.gradient(text, start, end);
}

module.exports = function mailPlugin(bot) {
    function loadMails() {
        try {
            if (!fs.existsSync(MAIL_FILE)) {
                fs.writeFileSync(MAIL_FILE, JSON.stringify([]));
                return [];
            }
            const raw = fs.readFileSync(MAIL_FILE, 'utf8');
            return JSON.parse(raw) || [];
        } catch (e) {
            console.error(`[${bot.id}] [Mail] Failed to load mails:`, e);
            return [];
        }
    }

    function saveMails(mails) {
        try {
            fs.writeFileSync(MAIL_FILE, JSON.stringify(mails, null, 4));
            return true;
        } catch (e) {
            console.error(`[${bot.id}] [Mail] Failed to save mails:`, e);
            return false;
        }
    }

    function getUnread(player) {
        return loadMails().filter(m => m.to === player && !m.read);
    }

    function getPlayerMails(player) {
        return loadMails().filter(m => m.to === player);
    }

    function sendMail(from, to, text) {
        const mails = loadMails();
        mails.push({ from, to, text, time: Date.now(), read: false });
        saveMails(mails);
        return true;
    }

    function markRead(player) {
        const mails = loadMails();
        let updated = false;
        for (const mail of mails) {
            if (mail.to === player && !mail.read) {
                mail.read = true;
                updated = true;
            }
        }
        if (updated) {
            const now = Date.now();
            const filtered = mails.filter(m => {
                if (m.to !== player) return true;
                if (m.read && (now - m.time > 7 * 24 * 60 * 60 * 1000)) return false;
                return true;
            });
            saveMails(filtered);
        }
        return updated;
    }

    function clearMails(player, onlyRead = true) {
        const mails = loadMails();
        const filtered = mails.filter(m => {
            if (m.to !== player) return true;
            if (onlyRead && !m.read) return true;
            return false;
        });
        if (filtered.length !== mails.length) {
            saveMails(filtered);
            return true;
        }
        return false;
    }

    bot.mail = {
        send: sendMail,
        getUnread,
        getPlayerMails,
        markRead,
        clear: clearMails,
        load: loadMails,
        save: saveMails
    };

    function notifyPlayer(name) {
        const unread = getUnread(name);
        if (unread.length === 0) return;
        const extra = [];
        const textPart = `You have ${unread.length} unread messages. `;
        extra.push(...grad(textPart, '#f4fcff', '#238bff'));
        extra.push({
            text: '[Read]',
            color: '#62d66b',
            click_event: {
                action: 'suggest_command',
                command: 'nr:mail read'
            },
            hover_event: {
                action: 'show_text',
                value: { text: 'Click to read mail', color: 'green' }
            }
        });

        extra.push({ text: ' ', color: 'gray' });
        extra.push({
            text: '[Clear]',
            color: '#ff6b6b',
            click_event: {
                action: 'suggest_command',
                command: 'nr:mail clear'
            },
            hover_event: {
                action: 'show_text',
                value: { text: 'Click to clear read mail', color: 'red' }
            }
        });

        const msg = { text: '', extra };
        const snbt = toSNBT(msg);
        const command = `tellraw ${name} ${snbt}`;

        if (bot.core && bot.core.ready && typeof bot.core.run === 'function') {
            bot.core.run(command);
        }
    }

    bot.on('player_added', (player) => {
        const name = player.username;
        if (!name) return;
        setTimeout(() => notifyPlayer(name), 100);
    });

    bot.on('bot:login', () => {
        setTimeout(() => {
            if (bot.players) {
                const players = Array.isArray(bot.players) ? bot.players : Object.values(bot.players);
                for (const p of players) {
                    const name = p.username || p.name;
                    if (name) notifyPlayer(name);
                }
            }
        }, 500);
    });

    setInterval(() => {
        const mails = loadMails();
        const now = Date.now();
        const filtered = mails.filter(m => {
            if (!m.read) return true;
            if (m.read && (now - m.time < 7 * 24 * 60 * 60 * 1000)) return true;
            return false;
        });
        if (filtered.length !== mails.length) {
            saveMails(filtered);
        }
    }, 3600000);
};