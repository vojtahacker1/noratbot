const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const grad = require('../utils/gradient');

if (!global.discordClient) global.discordClient = null;
if (!global.clientReady) global.clientReady = false;
if (!global.channelMap) global.channelMap = new Map();
if (!global.discordCommands) global.discordCommands = new Map();
if (!global.commandPrefix) global.commandPrefix = '!';
if (!global.processedMessages) global.processedMessages = new Set();

const cmdDir = path.join(process.cwd(), 'discordcommands');

function formatReason(r) {
    if (typeof r === 'string') return r;
    if (typeof r === 'object') {
        if (r.text) return r.text;
        if (r.translate) {
            let m = `[${r.translate}]`;
            if (r.with && Array.isArray(r.with)) {
                const args = r.with.map(a => {
                    if (typeof a === 'string') return a;
                    if (typeof a === 'object' && a.text) return a.text;
                    if (typeof a === 'object' && a.translate) return `[${a.translate}]`;
                    return String(a);
                }).join(', ');
                m += ` ${args}`;
            }
            return m;
        }
        if (r.key) {
            let m = `[${r.key}]`;
            if (r.arguments && Array.isArray(r.arguments)) {
                const args = r.arguments.map(a => {
                    if (typeof a === 'string') return a;
                    if (typeof a === 'object' && a.text) return a.text;
                    if (typeof a === 'object' && a.translate) return `[${a.translate}]`;
                    return String(a);
                }).join(', ');
                m += ` ${args}`;
            }
            return m;
        }
        if (r.extra) return formatReason(r.extra);
        if (Array.isArray(r)) return r.map(x => formatReason(x)).join(', ');
        if (r.description) return r.description;
        if (r.message) return r.message;
    }
    return String(r);
}

async function waitCore(bot, timeout = 10000) {
    return new Promise(resolve => {
        if (bot.core && typeof bot.core.run === 'function') {
            resolve(true);
            return;
        }
        const start = Date.now();
        const iv = setInterval(() => {
            if (bot.core && typeof bot.core.run === 'function') {
                clearInterval(iv);
                resolve(true);
            } else if (Date.now() - start > timeout) {
                clearInterval(iv);
                resolve(false);
            }
        }, 100);
    });
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

async function handleMsg(bot, msg) {
    try {
        const content = msg.content || '';
        const hasCore = await waitCore(bot);

        const atts = [];
        if (msg.attachments.size > 0) {
            for (const [, att] of msg.attachments) {
                let type = 'file';
                if (att.contentType) {
                    if (att.contentType.startsWith('image/')) type = 'image';
                    else if (att.contentType.startsWith('video/')) type = 'video';
                    else if (att.contentType.startsWith('audio/')) type = 'audio';
                }
                atts.push({ name: att.name || 'file', url: att.url, type });
            }
        }

        let full = content
            .replace(/@everyone/gi, '@  everyone')
            .replace(/@here/gi, '@  here')
            .replace(/&/g, '&amp;')
            .replace(/§/g, '');

        let author = msg.author.username;
        if (msg.member && msg.member.displayName) author = msg.member.displayName;

        let reply = '';
        let replyTargetName = '';
        if (msg.reference && msg.reference.messageId) {
            try {
                const replied = await msg.channel.messages.fetch(msg.reference.messageId);
                if (replied && !replied.author.bot) {
                    let rn = replied.author.username;
                    if (replied.member && replied.member.displayName) rn = replied.member.displayName;
                    replyTargetName = rn;
                    reply = ` (reply @${rn})`;
                }
            } catch (e) {}
        }

        let attText = '';
        if (atts.length) {
            const strs = atts.map(a => `[${a.type}: ${a.name}]`).join(' ');
            attText = ' ' + strs;
        }

        const rawMessageText = reply ? `${reply}: ${full}` : `: ${full}`;
        let msgBody = rawMessageText;
        if (attText) msgBody += attText;

        if (msgBody.length > 500) msgBody = msgBody.substring(0, 500) + '...';

        const link = bot.globalConfig?.discord?.link || 'https://discord.gg';
        let extra = [];

        extra.push({
            text: '[noratbot Discord] ',
            color: '#55aaff',
            click_event: {
                action: 'copy_to_clipboard',
                value: link
            },
            hover_event: {
                action: 'show_text',
                value: {
                    text: `noratbot Discord\n\nLink: ${link}\nAction: Click to copy invite link`,
                    color: 'aqua'
                }
            }
        });

        const discordTag = msg.author.tag || msg.author.username;
        const discordId = msg.author.id;

        let authorHoverText = `Discord User Profile\n\n• Tag: ${discordTag}\n• ID: ${discordId}`;
        if (replyTargetName) {
            authorHoverText += `\n• Status: Replying to @${replyTargetName}`;
        }
        authorHoverText += `\n\n» Click to copy author's nickname «`;

        extra.push({
            text: author,
            color: '#62d66b',
            click_event: {
                action: 'copy_to_clipboard',
                value: author
            },
            hover_event: {
                action: 'show_text',
                value: {
                    text: authorHoverText,
                    color: 'green'
                }
            }
        });

        if (msgBody) {
            let textToCopy = full;
            if (attText) textToCopy += attText;
            if (textToCopy.length > 1000) textToCopy = textToCopy.substring(0, 1000) + '...';

            const charCount = textToCopy.length;

            const color = '#d4d4d4';
            const textComponent = {
                text: msgBody,
                color: color,
                click_event: {
                    action: 'copy_to_clipboard',
                    value: textToCopy
                },
                hover_event: {
                    action: 'show_text',
                    value: {
                        text: `Message Info\n• Length: ${charCount} chars\n\n» Click to copy clean message body «`,
                        color: 'gray'
                    }
                }
            };
            extra.push(textComponent);
        }

        const root = { text: '', extra };
        const cmd = `tellraw @a ${toSNBT(root)}`;

        if (hasCore && bot.core && typeof bot.core.run === 'function') {
            bot.core.run(cmd);
        }
    } catch (e) {
        console.error(`[${bot.id}] [Discord] handleMsg error:`, e);
    }
}

function loadCmds() {
    global.discordCommands.clear();
    if (!fs.existsSync(cmdDir)) {
        fs.mkdirSync(cmdDir, { recursive: true });
        return;
    }
    const files = fs.readdirSync(cmdDir).filter(f => f.endsWith('.js'));
    for (const f of files) {
        try {
            const cmd = require(path.join(cmdDir, f));
            if (cmd && typeof cmd.execute === 'function') {
                const name = cmd.name || path.basename(f, '.js').toLowerCase();
                global.discordCommands.set(name, cmd);
                if (Array.isArray(cmd.aliases)) {
                    for (const alias of cmd.aliases) {
                        if (typeof alias === 'string' && alias.trim()) {
                            global.discordCommands.set(alias.trim().toLowerCase(), cmd);
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`[Discord] Failed to load ${f}:`, e);
        }
    }
}

// ---- Discord command support (output goes to Discord only, never to the Minecraft server) ----

function parseSNBT(src) {
    let i = 0;
    const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
    function str(q) {
        let out = '';
        i++;
        while (i < src.length && src[i] !== q) {
            if (src[i] === '\\') {
                i++;
                out += src[i] === 'n' ? '\n' : src[i];
                i++;
                continue;
            }
            out += src[i++];
        }
        i++;
        return out;
    }
    function val() {
        ws();
        const c = src[i];
        if (c === '{') {
            i++;
            const o = {};
            ws();
            while (src[i] !== '}') {
                ws();
                let k;
                if (src[i] === "'" || src[i] === '"') k = str(src[i]);
                else { const m = /^[A-Za-z0-9_.+\-]+/.exec(src.slice(i)); k = m[0]; i += k.length; }
                ws(); i++; // :
                o[k] = val();
                ws();
                if (src[i] === ',') i++;
                ws();
            }
            i++;
            return o;
        }
        if (c === '[') {
            i++;
            const a = [];
            ws();
            while (src[i] !== ']') {
                a.push(val());
                ws();
                if (src[i] === ',') i++;
                ws();
            }
            i++;
            return a;
        }
        if (c === "'" || c === '"') return str(c);
        const m = /^[^,\]}\s]+/.exec(src.slice(i));
        i += m[0].length;
        if (m[0] === 'true') return true;
        if (m[0] === 'false') return false;
        return isNaN(Number(m[0])) ? m[0] : Number(m[0]);
    }
    return val();
}

function plainText(x) {
    if (x == null) return '';
    if (typeof x === 'string') return x;
    if (typeof x === 'number' || typeof x === 'boolean') return String(x);
    if (Array.isArray(x)) return x.map(plainText).join('');
    let t = typeof x.text === 'string' ? x.text : '';
    if (!t && x.translate) t = `[${x.translate}]`;
    if (x.extra) t += plainText(x.extra);
    return t;
}

function toPlain(x) {
    if (typeof x !== 'string') return plainText(x).replace(/§[0-9a-fk-or]/gi, '');
    return x.replace(/§[0-9a-fk-or]/gi, '');
}

async function handleCommand(client, msg) {
    const args = msg.content.slice(global.commandPrefix.length).trim().split(/\s+/);
    const name = args.shift()?.toLowerCase();
    if (!name) return false;

    const send = text => {
        const out = String(text ?? '').trim();
        if (!out) return true;
        msg.reply({ content: out.slice(0, 1990), allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
        return true;
    };

    // The channel decides which server's bot runs the command
    const bot = global.channelMap.get(msg.channel.id);
    const cmd = bot?.commands?.get(name);

    if (!cmd) {
        // plain Discord-only commands from /discordcommands
        const dc = global.discordCommands.get(name);
        if (!dc) return false;
        try {
            const r = await dc.execute(msg, args, client, null);
            if (typeof r === 'string' && r) await msg.reply(r);
            else if (r instanceof EmbedBuilder) await msg.reply({ embeds: [r] });
            else if (r?.embed) await msg.reply({ embeds: [r.embed] });
        } catch (e) {
            console.error(`[Discord] Command error (${name}):`, e);
            await msg.reply('Command error').catch(() => {});
        }
        return true;
    }

    const dconf = bot.globalConfig?.discord || {};
    const has = id => id && msg.member?.roles?.cache?.has(String(id));
    const level = has(dconf.adminId) ? 2 : has(dconf.trustedId) ? 1 : 0;
    if (cmd.level > level) { send('Permission denied. Required level: ' + cmd.level); return true; }

    const username = bot.config.username;
    const uuid = bot.commands.getPlayerUUID(username);
    if (!uuid) { send('Bot UUID unavailable'); return true; }

    const ctx = {
        bot,
        bots: bot.manager?.bots || new Map(),
        player: { name: username, uuid },
        command: cmd,
        commandName: cmd.name,
        args,
        raw: [name, ...args].join(' '),
        message: msg,
        prefix: global.commandPrefix,
        level,
        source: 'discord',
        levels: { PUBLIC: 0, TRUSTED: 1, ADMIN: 2 },
        commands: new Map(bot.commands.all().flatMap(c => [[c.name, c], ...(c.aliases || []).map(x => [x, c])])),
        commandsDir: path.join(process.cwd(), 'commands'),
        core: bot.core,
        // tellraw output is redirected to Discord; everything else still runs on the server
        run: x => {
            const m = /^\/?tellraw\s+\S+\s+([\s\S]+)$/.exec(String(x));
            if (m) {
                let comp;
                try { comp = JSON.parse(m[1]); } catch { try { comp = parseSNBT(m[1]); } catch { comp = m[1]; } }
                return send(toPlain(comp));
            }
            return bot.core?.run(x);
        },
        tellraw: (who, x) => send(toPlain(x)),
        tellrawCommand: x => send(toPlain(x)),
        reply: x => send(x)
    };

    try {
        const r = await cmd.execute(ctx);
        if (typeof r === 'string' && r) send(r);
    } catch (e) {
        console.error(e);
        send('Command error: ' + e.message);
    }
    return true;
}

function setupDC(config) {
    if (global.discordClient) return;
    global.commandPrefix = config.commandPrefix || '!';

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ],
        partials: [Partials.Channel]
    });

    client.login(config.token).catch(e => console.error('[Discord] Login error:', e));

    client.once('ready', () => {
        global.clientReady = true;
        loadCmds();
    });

    client.on('messageCreate', async msg => {
        if (msg.author.bot) return;
        if (msg.author.id === client.user.id) return;
        const ch = msg.channel;
        if (!ch || ch.type !== 0) return;

        // "!cmd" in a server's channel runs that server's bot command; output stays in Discord only
        if (msg.content.startsWith(global.commandPrefix)) {
            if (await handleCommand(client, msg)) return;
        }

        const target = global.channelMap.get(ch.id);
        if (!target) return;
        await handleMsg(target, msg);
    });

    global.discordClient = client;
}

module.exports = function discordBridge(bot) {
    const gconf = bot.globalConfig;
    const dconf = gconf?.discord;
    if (!dconf || !dconf.enabled) return;

    const cid = bot.config.channelId;
    if (!cid) {
        console.log(`[${bot.id}] [Discord] No channelId, skipping.`);
        return;
    }

    if (!global.discordClient) setupDC(dconf);
    if (!global.channelMap.has(cid)) {
        global.channelMap.set(cid, bot);
    } else if (global.channelMap.get(cid) !== bot) {
        console.log(`[${bot.id}] [Discord] Log channel ${cid} already registered by another bot, skipping.`);
        return;
    }

    let buf = [];
    let timer = null;
    const INTERVAL = 900;
    const MAX_BUF = 50;
    const MAX_SEND = 5;
    const GROUP = true;

    function statusMsg(text) {
        if (global.clientReady) {
            const ch = global.discordClient.channels.cache.get(cid);
            if (ch) ch.send(`\`${text}\``).catch(e => console.error(`[${bot.id}] [Discord] Send error:`, e));
        }
    }

    function sendBuf(channelId, messages) {
        if (!global.clientReady) return;
        const ch = global.discordClient.channels.cache.get(channelId);
        if (!ch) {
            console.error(`[${bot.id}] [Discord] Channel ${channelId} not found.`);
            return;
        }
        let toSend = messages;
        let extra = '';
        if (messages.length > MAX_SEND) {
            toSend = messages.slice(0, MAX_SEND);
            extra = `\n... and ${messages.length - MAX_SEND} more messages`;
        }
        let combined = toSend.join('\n');
        if (extra) combined += extra;
        ch.send('```\n' + combined + '\n```').catch(e => console.error(`[${bot.id}] [Discord] Send error:`, e));
    }

    function addMsg(text) {
        if (!text || text.trim() === '') return;

        let safeText = text.replaceAll('`', '\u200b`');

        if (buf.length >= MAX_BUF) while (buf.length >= MAX_BUF) buf.shift();
        if (GROUP && buf.length > 0 && buf[buf.length - 1] === safeText) return;
        buf.push(safeText);
        if (!timer) {
            timer = setTimeout(() => {
                timer = null;
                if (buf.length === 0) return;
                const combined = buf.join('\n');
                buf = [];
                const formatted = '```\n' + combined + '\n```';
                const maxLen = 1990;
                if (formatted.length > maxLen) {
                    let rem = formatted;
                    while (rem.length > maxLen) {
                        let cut = maxLen;
                        while (cut > 0 && rem[cut] !== '\n') cut--;
                        if (cut === 0) cut = maxLen;
                        sendBuf(cid, [rem.substring(0, cut)]);
                        rem = rem.substring(cut);
                    }
                    if (rem) sendBuf(cid, [rem]);
                } else {
                    sendBuf(cid, [combined]);
                }
            }, INTERVAL);
        }
    }
    const handlers = {
        onConnecting(host, port) {
            statusMsg(`Attempting to connect to ${host}:${port}...`);
        },

        onConnected() {
            statusMsg('Connected to server.');
        },

        onDisconnect(r) {
            statusMsg(`Disconnected: ${formatReason(r)}`);

            if (timer) {
                clearTimeout(timer);
                timer = null;
            }

            if (buf.length) {
                const combined = buf.join('\n');
                buf = [];
                const formatted = '```\n' + combined + '\n```';
                for (let i = 0; i < formatted.length; i += 1990) {
                    sendBuf(cid, [formatted.substring(i, i + 1990)]);
                }
            }

            destroy();
        },

        onChatDisplay(msg) {
            if (!msg) return;
            addMsg(msg);
        }
    };

    bot.on('bot:connecting', handlers.onConnecting);
    bot.on('bot:connected', handlers.onConnected);
    bot.on('bot:disconnect', handlers.onDisconnect);
    bot.on('chat_display', handlers.onChatDisplay);

    function destroy() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        buf = [];

        bot.removeListener('bot:connecting', handlers.onConnecting);
        bot.removeListener('bot:connected', handlers.onConnected);
        bot.removeListener('bot:disconnect', handlers.onDisconnect);
        bot.removeListener('chat_display', handlers.onChatDisplay);
        if (global.channelMap.get(cid) === bot) {
            global.channelMap.delete(cid);
        }
        if (bot.discordBridgeDestroy === destroy) {
            bot.discordBridgeDestroy = null;
        }
    }
    bot.discordBridgeDestroy = destroy;
};