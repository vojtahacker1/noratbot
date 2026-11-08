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
if (!global.commandsChannelId) global.commandsChannelId = null;

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

function setupDC(config) {
    if (global.discordClient) return;
    global.commandPrefix = config.commandPrefix || '!';
    global.commandsChannelId = config.messagesId || null;

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
        if (!global.commandsChannelId) console.log('[Discord] No commands channel configured (messagesId missing)');
    });

    client.on('messageCreate', async msg => {
        if (msg.author.bot) return;
        if (msg.author.id === client.user.id) return;
        const ch = msg.channel;
        if (!ch || ch.type !== 0) return;

        if (global.commandsChannelId && ch.id === global.commandsChannelId) {
            if (msg.content.startsWith(global.commandPrefix)) {
                const args = msg.content.slice(global.commandPrefix.length).trim().split(/\s+/);
                const cmdName = args.shift().toLowerCase();
                const cmd = global.discordCommands.get(cmdName);
                if (cmd) {
                    try {
                        const result = await cmd.execute(msg, args, client, null);
                        if (result) {
                            if (typeof result === 'string') await msg.reply(result);
                            else if (result instanceof EmbedBuilder) await msg.reply({ embeds: [result] });
                            else if (result.embed) await msg.reply({ embeds: [result.embed] });
                        }
                    } catch (e) {
                        console.error(`[Discord] Command error (${cmdName}):`, e);
                        await msg.reply('Command error');
                    }
                }
                return;
            }
            return;
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