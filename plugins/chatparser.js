// idea partially taken from chipmunkbot
// credits to chipmunk
const RESET = '\x1b[0m';
const fs = require('fs');
const path = require('path');

const PALETTE = {
    black: [0, 0, 0],
    dark_blue: [0, 0, 170],
    dark_green: [0, 170, 0],
    dark_aqua: [0, 170, 170],
    dark_red: [170, 0, 0],
    dark_purple: [170, 0, 170],
    gold: [255, 170, 0],
    gray: [170, 170, 170],
    dark_gray: [85, 85, 85],
    blue: [85, 85, 255],
    green: [85, 255, 85],
    aqua: [85, 255, 255],
    red: [255, 85, 85],
    light_purple: [255, 85, 255],
    yellow: [255, 255, 85],
    white: [255, 255, 255]
};

let TRANSLATE = {};

function loadTranslations() {
    const p = path.join(process.cwd(), 'translations.json');
    try {
        if (fs.existsSync(p)) {
            const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (typeof parsed === 'object' && parsed !== null) TRANSLATE = parsed;
        }
    } catch (e) {
        console.error('[ChatParser] Failed to load translations.json:', e);
    }
}
loadTranslations();

function nbt(v) {
    if (!v) return { text: '' };
    if (v.type === 'byte') return !!v.value;
    if (typeof v.value !== 'object' || v.value === null) return v.value;
    if (Array.isArray(v.value)) return [...v.value];
    if (v.type === 'list') {
        return v.value.value.map(item => nbt({ type: v.value.type, value: item }));
    }
    return Object.fromEntries(
        Object.entries(v.value).map(([k, item]) => [k === '' ? 'text' : k, nbt(item)])
    );
}

function decode(v) {
    if (v && typeof v === 'object' && v.type) return nbt(v);
    if (typeof v === 'string') {
        try { return JSON.parse(v); }
        catch { return { text: v }; }
    }
    return v;
}

function normalize(v) {
    if (typeof v === 'string') return { text: v };
    if (Array.isArray(v)) {
        if (!v.length) return { text: '' };
        const first = normalize(v[0]);
        return { ...first, extra: v.slice(1) };
    }
    if (!v || typeof v !== 'object') return { text: '' };
    return v;
}

function rgb(c) {
    if (!c) return '';
    if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) {
        const r = parseInt(c.slice(1, 3), 16);
        const g = parseInt(c.slice(3, 5), 16);
        const b = parseInt(c.slice(5, 7), 16);
        return `\x1b[38;2;${r};${g};${b}m`;
    }
    const val = PALETTE[c];
    if (!val) return '';
    return `\x1b[38;2;${val[0]};${val[1]};${val[2]}m`;
}

function style(comp) {
    let s = '';
    if (comp.bold) s += '\x1b[1m';
    if (comp.italic) s += '\x1b[3m';
    if (comp.underlined) s += '\x1b[4m';
    if (comp.strikethrough) s += '\x1b[9m';
    if (comp.obfuscated) s += '\x1b[8m';
    return s;
}

function renderTranslate(comp, state) {
    const vals = Array.isArray(comp.with) ? comp.with.map(item => render(item, state)) : [];
    if (comp.translate === 'advMode.setCommand.success') return '';
    let tmpl = TRANSLATE[comp.translate];
    if (!tmpl) {
        tmpl = comp.translate;
    }
    let result = tmpl;
    for (const v of vals) {
        result = result.replace('%s', v);
    }
    return state.code + result;
}

function render(comp, parent = { color: '', formatting: '', code: '' }) {
    if (comp == null) return '';
    if (typeof comp === 'string') return parent.code + comp;
    if (typeof comp !== 'object') return parent.code + String(comp);
    if (Array.isArray(comp)) return comp.map(c => render(c, parent)).join('');

    const cur = {
        color: comp.color ? rgb(comp.color) : parent.color,
        formatting: style(comp)
    };
    cur.code = cur.color + cur.formatting;
    if (!comp.color && !cur.formatting) cur.code = parent.code || '';

    let out = '';
    if (comp.text !== undefined) {
        let text = String(comp.text);
        if (comp.with && Array.isArray(comp.with)) {
            let idx = 0;
            for (const arg of comp.with) {
                const argStr = render(arg, cur);
                text = text.replace('%s', argStr);
                idx++;
            }
        }
        out += cur.code + text;
    }
    if (comp.translate) out += renderTranslate(comp, cur);
    if (comp.selector !== undefined) out += cur.code + String(comp.selector);
    if (comp.keybind !== undefined) out += cur.code + String(comp.keybind);
    if (comp.score && comp.score.value !== undefined) {
        out += cur.code + String(comp.score.value);
    }
    if (Array.isArray(comp.extra)) {
        for (const child of comp.extra) {
            out += render(child, cur);
        }
    }
    return out;
}

function stringify(v) {
    return render(normalize(decode(v)), { color: '', formatting: '', code: '' });
}

function stripAnsi(v) {
    return String(v).replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '');
}

function cacheUUIDs(bot) {
    if (!bot.playerUUIDs || !(bot.playerUUIDs instanceof Map)) bot.playerUUIDs = new Map();
    if (!bot.players || typeof bot.players !== 'object') return;
    for (const [name, player] of Object.entries(bot.players)) {
        if (!player?.uuid) continue;
        const key = String(name).toLowerCase();
        const old = bot.playerUUIDs.get(key);
        if (old === player.uuid) continue;
        bot.playerUUIDs.set(key, player.uuid);
        if (bot.globalConfig?.logging?.uuid !== false) {
            console.log(`[${bot.id}] [ChatParser] UUID cached: ${name} -> ${player.uuid}`);
        }
    }
}

function replacePercentS(text, withArray) {
    if (!withArray || !Array.isArray(withArray) || withArray.length === 0) return text;
    let result = text;
    let idx = 0;
    while (result.includes('%s') && idx < withArray.length) {
        const replacement = stringify(withArray[idx]);
        result = result.replace('%s', replacement);
        idx++;
    }
    return result;
}

function parseChipmunkMod(message, bot) {
    try {
        const fullText = stringify(message);
        let plain = stripAnsi(fullText).trim();

        for (let i = 0; i < 3; i++) {
            plain = plain.replace(/^\[[^\]]+\]\s*/, '');
        }

        if (plain.startsWith('/')) return null;

      /*  let match = plain.match(/\[[^\]]+\]\s+([^\s›]+)\s*›\s*(.*)/);
        if (match) {
            const senderName = match[1].trim();
            const contents = match[2].trim();
            const sender = findPlayerByNameOrUUID(senderName, bot);
            return { sender: sender || senderName, contents};
        }

        match = plain.match(/<([^>]+)>\s*(.*)/);
        if (match) {
            const senderName = match[1].trim();
            const contents = match[2].trim();
            const sender = findPlayerByNameOrUUID(senderName, bot);
            return { sender: sender || senderName, contents};
        }

        match = plain.match(/^([^:]+):\s*(.*)/);
        if (match) {
            const senderName = match[1].trim();
            const contents = match[2].trim();
            if (senderName && contents && !contents.startsWith('/')) {
                const sender = findPlayerByNameOrUUID(senderName, bot);
                return { sender: sender || senderName, contents};
            }
        }

        match = plain.match(/^([^\s›]+)\s*›\s*(.*)/);
        if (match) {
            const senderName = match[1].trim();
            const contents = match[2].trim();
            const sender = findPlayerByNameOrUUID(senderName, bot);
            return { sender: sender || senderName, contents};
        }*/

        return null;
    } catch (e) {
        console.error('[ChatParser] ChipmunkMod parse error:', e);
        return null;
    }
}

function findPlayerByNameOrUUID(nameOrUUID, bot) {
    if (!bot) return null;
    if (bot.playersAPI && typeof bot.playersAPI.getAll === 'function') {
        const players = bot.playersAPI.getAll();
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrUUID)) {
            const found = players.find(p => p.uuid === nameOrUUID);
            if (found) return found;
        }
        const lower = nameOrUUID.toLowerCase();
        const found = players.find(p => (p.username || p.profile?.name || '').toLowerCase() === lower);
        if (found) return found;
    }
    if (bot.players && typeof bot.players === 'object') {
        for (const [name, player] of Object.entries(bot.players)) {
            if (name.toLowerCase() === nameOrUUID.toLowerCase()) return player;
            if (player.uuid === nameOrUUID) return player;
        }
    }
    return null;
}
function extractPlainText(component) {
    if (typeof component === 'string') return component;
    if (!component || typeof component !== 'object') return '';
    if (component.text) return String(component.text);
    if (Array.isArray(component.extra)) {
        return component.extra.map(extractPlainText).join('');
    }
    if (component.selector) return component.selector;
    if (component.keybind) return component.keybind;
    if (component.score) return String(component.score.value || '');
    return '';
}
function write(bot, v) {
    const result = stringify(v);
    if (!result) return;
    bot.emit('chat_raw', result);
    let displayText = stripAnsi(result);
    let plainForCommands = displayText;
    if (displayText.includes('[PLAYER_LIST]')) {
        bot.emit('chat_plain', displayText);
        return;
    }

    const parsed = parseChipmunkMod(v, bot);
    if (parsed) {
        const senderName = typeof parsed.sender === 'string' ? parsed.sender : parsed.sender?.username || 'Unknown';
        plainForCommands = `${senderName}: ${parsed.contents}`;
    } else {
        const match = displayText.match(/^<([^>]+)>\s*(.*)/);
        if (match) {
            const senderName = match[1].trim();
            const contents = match[2].trim();
            if (senderName && contents) {
                const fixedContents = contents.replace(/:/g, ';');
                plainForCommands = `${senderName}: ${fixedContents}`;
            }
        } else {
            const match2 = displayText.match(/^([^:]+):\s*(.*)/);
            if (match2) {
                const senderName = match2[1].trim();
                const contents = match2[2].trim();
                if (senderName && contents && !['System', 'Server'].includes(senderName) && !contents.startsWith('/')) {
                    const fixedContents = contents.replace(/:/g, ';');
                    plainForCommands = `${senderName}: ${fixedContents}`;
                }
            }
        }
    }

    process.stdout.write(`[${bot.id}] ` + result + RESET + '\n');
    bot.emit('chat_display', displayText);
    bot.emit('chat_plain', plainForCommands);
}
module.exports = function chatParser(bot) {
    if (!bot.playerUUIDs || !(bot.playerUUIDs instanceof Map)) bot.playerUUIDs = new Map();
    if (!bot.chatSenderUUIDs || !(bot.chatSenderUUIDs instanceof Map)) bot.chatSenderUUIDs = new Map();
    cacheUUIDs(bot);

    const timer = setInterval(() => {
        if (bot.ended || bot.destroyed) return;
        cacheUUIDs(bot);
    }, 1000);

    const uuidCleanup = setInterval(() => {
        const now = Date.now();
        for (const [k, v] of bot.chatSenderUUIDs) {
            if (now - v.ts > 30000) bot.chatSenderUUIDs.delete(k);
        }
    }, 10000);

    const handlers = {
        onLogin() {
            setTimeout(() => cacheUUIDs(bot), 100);
            setTimeout(() => cacheUUIDs(bot), 1000);
        },

        onPlayerInfo() {
            cacheUUIDs(bot);
        },

        onPlayerInfoUpdate() {
            cacheUUIDs(bot);
        },

        onPlayerInfoRemove() {
            setTimeout(() => cacheUUIDs(bot), 50);
        },

        onPlayerChat(p) {
            const senderUuid = p.senderUuid || p.sender;
            if (senderUuid) {
                try {
                    const nameComp = p.networkName || p.senderName;
                    if (nameComp) {
                        const nameStr = stripAnsi(stringify(nameComp)).trim();
                        if (nameStr && nameStr !== 'System') {
                            bot.chatSenderUUIDs.set(nameStr.toLowerCase(), { uuid: senderUuid, ts: Date.now() });
                        }
                    }
                } catch (e) {}
            }
            cacheUUIDs(bot);
            const val = p.unsignedChatContent ?? p.message ?? p.plainMessage;
            if (val != null) write(bot, val);
        },

        onSystemChat(p) {
            if (!p.isActionBar && p.content != null) write(bot, p.content);
        },

        onChat(p) {
            cacheUUIDs(bot);
            if (p.message != null) write(bot, p.message);
        },

        onEnd() {
            destroy();
        },

        onDisconnect() {
            destroy();
        }
    };

    bot.on('login', handlers.onLogin);
    bot.on('player_info', handlers.onPlayerInfo);
    bot.on('player_info_update', handlers.onPlayerInfoUpdate);
    bot.on('player_info_remove', handlers.onPlayerInfoRemove);
    bot.on('player_chat', handlers.onPlayerChat);
    bot.on('system_chat', handlers.onSystemChat);
    bot.on('chat', handlers.onChat);
    bot.on('end', handlers.onEnd);
    bot.on('bot:disconnect', handlers.onDisconnect);

    function destroy() {
        clearInterval(timer);
        clearInterval(uuidCleanup);

        bot.removeListener('login', handlers.onLogin);
        bot.removeListener('player_info', handlers.onPlayerInfo);
        bot.removeListener('player_info_update', handlers.onPlayerInfoUpdate);
        bot.removeListener('player_info_remove', handlers.onPlayerInfoRemove);
        bot.removeListener('player_chat', handlers.onPlayerChat);
        bot.removeListener('system_chat', handlers.onSystemChat);
        bot.removeListener('chat', handlers.onChat);
        bot.removeListener('end', handlers.onEnd);
        bot.removeListener('bot:disconnect', handlers.onDisconnect);

        bot.chatSenderUUIDs.clear();
        bot.playerUUIDs.clear();
    }

    bot.chatParserDestroy = destroy;
};