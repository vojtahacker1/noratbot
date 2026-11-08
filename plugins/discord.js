
const {
    Client,
    GatewayIntentBits,
    Partials,
    ChannelType,
    EmbedBuilder
} = require('discord.js');

const fs = require('fs');
const path = require('path');

if (!global.discordClient) global.discordClient = null;
if (!global.clientReady) global.clientReady = false;
if (!global.channelMap) global.channelMap = new Map();
if (!global.discordCommands) global.discordCommands = new Map();
if (!global.commandPrefix) global.commandPrefix = '!';
if (!global.processedMessages) global.processedMessages = new Set();

const cmdDir = path.join(process.cwd(), 'discordcommands');

const COLORS = {
    default: 0x5865F2,
    public: 0x5865F2,
    trusted: 0x57F287,
    admin: 0xF1C40F,
    success: 0x57F287,
    error: 0xED4245,
    warning: 0xFEE75C
};

function createEmbed(description, options = {}) {
    const embed = new EmbedBuilder()
        .setColor(options.color ?? COLORS.default)
        .setTimestamp();

    if (options.title) {
        embed.setTitle(String(options.title).slice(0, 256));
    }

    if (description) {
        embed.setDescription(String(description).slice(0, 4096));
    }

    if (options.footer) {
        embed.setFooter({
            text: String(options.footer).slice(0, 2048)
        });
    }

    return embed;
}

function splitText(text, limit = 3900) {
    text = String(text ?? '');
    if (!text) return [];

    const result = [];

    while (text.length > limit) {
        let cut = text.lastIndexOf('\n', limit);

        if (cut < limit * 0.5) {
            cut = text.lastIndexOf(' ', limit);
        }

        if (cut < limit * 0.5) cut = limit;

        result.push(text.slice(0, cut));
        text = text.slice(cut).replace(/^\n+/, '');
    }

    if (text) result.push(text);

    return result;
}

async function sendEmbed(channel, description, options = {}) {
    if (!channel || !channel.isTextBased()) return;

    const chunks = splitText(description);

    for (let i = 0; i < chunks.length; i++) {
        await channel.send({
            embeds: [
                createEmbed(chunks[i], {
                    ...options,
                    title: i === 0 ? options.title : undefined
                })
            ],
            allowedMentions: {
                parse: [],
                repliedUser: false
            }
        });
    }
}

async function sendCommandOutput(msg, output, options = {}) {
    if (output == null || output === '') return;

    if (output instanceof EmbedBuilder) {
        if (output.data.color == null) {
            output.setColor(options.color ?? COLORS.default);
        }

        await msg.reply({
            embeds: [output],
            allowedMentions: {
                parse: [],
                repliedUser: false
            }
        });

        return;
    }

    if (output?.embed instanceof EmbedBuilder) {
        await sendCommandOutput(msg, output.embed, options);
        return;
    }

    if (typeof output === 'object' && output.description) {
        await msg.reply({
            embeds: [
                createEmbed(output.description, {
                    title: output.title,
                    color: output.color ?? options.color ?? COLORS.default,
                    footer: options.footer
                })
            ],
            allowedMentions: {
                parse: [],
                repliedUser: false
            }
        });

        return;
    }

    await msg.reply({
        embeds: [
            createEmbed(String(output), {
                title: options.title ?? 'Command response',
                color: options.color ?? COLORS.default,
                footer: options.footer ?? 'noratbot • Discord'
            })
        ],
        allowedMentions: {
            parse: [],
            repliedUser: false
        }
    });
}

async function waitCore(bot, timeout = 10000) {
    if (bot.core && typeof bot.core.run === 'function') {
        return true;
    }

    return new Promise(resolve => {
        const start = Date.now();

        const iv = setInterval(() => {
            if (bot.core && typeof bot.core.run === 'function') {
                clearInterval(iv);
                resolve(true);
            } else if (Date.now() - start >= timeout) {
                clearInterval(iv);
                resolve(false);
            }
        }, 100);
    });
}

function toSNBT(obj) {
    if (typeof obj === 'string') {
        return "'" + obj
            .replace(/\\/g, '\\\\')
            .replace(/\n/g, '\\n')
            .replace(/'/g, "\\'") + "'";
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
        return String(obj);
    }

    if (Array.isArray(obj)) {
        return `[${obj.map(toSNBT).join(',')}]`;
    }

    if (typeof obj === 'object' && obj !== null) {
        const pairs = [];

        for (const key of Object.keys(obj)) {
            const safeKey = /^[A-Za-z0-9_.+-]+$/.test(key)
                ? key
                : toSNBT(key);

            pairs.push(`${safeKey}:${toSNBT(obj[key])}`);
        }

        return `{${pairs.join(',')}}`;
    }

    return "''";
}

async function handleMsg(bot, msg) {
    try {
        if (!await waitCore(bot)) return;

        const atts = [];

        for (const [, att] of msg.attachments) {
            let type = 'file';

            if (att.contentType?.startsWith('image/')) type = 'image';
            else if (att.contentType?.startsWith('video/')) type = 'video';
            else if (att.contentType?.startsWith('audio/')) type = 'audio';

            atts.push({
                name: att.name || 'file',
                url: att.url,
                type
            });
        }

        const full = (msg.content || '')
            .replace(/@everyone/gi, '@ everyone')
            .replace(/@here/gi, '@ here')
            .replace(/&/g, '&amp;')
            .replace(/§/g, '');

        const author = msg.member?.displayName || msg.author.username;

        let reply = '';
        let replyTargetName = '';

        if (msg.reference?.messageId) {
            try {
                const replied = await msg.channel.messages.fetch(
                    msg.reference.messageId
                );

                if (replied && !replied.author.bot) {
                    replyTargetName =
                        replied.member?.displayName ||
                        replied.author.username;

                    reply = ` (reply @${replyTargetName})`;
                }
            } catch {}
        }

        const attText = atts.length
            ? ' ' + atts.map(a => `[${a.type}: ${a.name}]`).join(' ')
            : '';

        let msgBody = reply
            ? `${reply}: ${full}`
            : `: ${full}`;

        msgBody += attText;

        if (msgBody.length > 500) {
            msgBody = msgBody.slice(0, 497) + '...';
        }

        const link = bot.globalConfig?.discord?.link ||
            'https://discord.gg';

        const extra = [
            {
                text: '[noratbot Discord] ',
                color: '#55aaff',
                click_event: {
                    action: 'copy_to_clipboard',
                    value: link
                },
                hover_event: {
                    action: 'show_text',
                    value: {
                        text: `noratbot Discord\n\nLink: ${link}`,
                        color: 'aqua'
                    }
                }
            },
            {
                text: author,
                color: '#62d66b',
                click_event: {
                    action: 'copy_to_clipboard',
                    value: author
                },
                hover_event: {
                    action: 'show_text',
                    value: {
                        text:
                            `Discord User Profile\n\n` +
                            `Tag: ${msg.author.tag || msg.author.username}\n` +
                            `ID: ${msg.author.id}` +
                            (replyTargetName
                                ? `\nReplying to: ${replyTargetName}`
                                : ''),
                        color: 'green'
                    }
                }
            }
        ];

        if (msgBody) {
            let textToCopy = full + attText;

            if (textToCopy.length > 1000) {
                textToCopy = textToCopy.slice(0, 997) + '...';
            }

            extra.push({
                text: msgBody,
                color: '#d4d4d4',
                click_event: {
                    action: 'copy_to_clipboard',
                    value: textToCopy
                },
                hover_event: {
                    action: 'show_text',
                    value: {
                        text:
                            `Message Info\n` +
                            `Length: ${textToCopy.length} chars\n\n` +
                            'Click to copy message',
                        color: 'gray'
                    }
                }
            });
        }

        bot.core.run(`tellraw @a ${toSNBT({
            text: '',
            extra
        })}`);

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
            const filePath = path.join(cmdDir, f);

            delete require.cache[require.resolve(filePath)];

            const cmd = require(filePath);

            if (cmd && typeof cmd.execute === 'function') {
                const name = (
                    cmd.name || path.basename(f, '.js')
                ).toLowerCase();

                global.discordCommands.set(name, cmd);

                if (Array.isArray(cmd.aliases)) {
                    for (const alias of cmd.aliases) {
                        if (typeof alias === 'string' && alias.trim()) {
                            global.discordCommands.set(
                                alias.trim().toLowerCase(),
                                cmd
                            );
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`[Discord] Failed to load ${f}:`, e);
        }
    }
}

function parseSNBT(src) {
    let i = 0;

    const ws = () => {
        while (i < src.length && /\s/.test(src[i])) i++;
    };

    function str(q) {
        let out = '';
        i++;

        while (i < src.length && src[i] !== q) {
            if (src[i] === '\\') {
                i++;

                if (i >= src.length) break;

                out += src[i] === 'n' ? '\n' : src[i];
                i++;
                continue;
            }

            out += src[i++];
        }

        if (src[i] !== q) throw new Error('Unterminated string');

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

            while (i < src.length && src[i] !== '}') {
                ws();

                let k;

                if (src[i] === "'" || src[i] === '"') {
                    k = str(src[i]);
                } else {
                    const m = /^[A-Za-z0-9_.+-]+/.exec(src.slice(i));

                    if (!m) throw new Error('Invalid SNBT key');

                    k = m[0];
                    i += k.length;
                }

                ws();

                if (src[i++] !== ':') {
                    throw new Error('Expected colon');
                }

                o[k] = val();
                ws();

                if (src[i] === ',') {
                    i++;
                    ws();
                } else if (src[i] !== '}') {
                    throw new Error('Expected comma or closing brace');
                }
            }

            if (src[i++] !== '}') {
                throw new Error('Unclosed compound');
            }

            return o;
        }

        if (c === '[') {
            i++;

            const a = [];
            ws();

            while (i < src.length && src[i] !== ']') {
                a.push(val());
                ws();

                if (src[i] === ',') {
                    i++;
                    ws();
                } else if (src[i] !== ']') {
                    throw new Error('Expected comma or closing bracket');
                }
            }

            if (src[i++] !== ']') {
                throw new Error('Unclosed array');
            }

            return a;
        }

        if (c === "'" || c === '"') {
            return str(c);
        }

        const m = /^[^,\]} \t\r\n]+/.exec(src.slice(i));

        if (!m) throw new Error('Invalid SNBT value');

        i += m[0].length;

        if (m[0] === 'true') return true;
        if (m[0] === 'false') return false;

        return isNaN(Number(m[0])) ? m[0] : Number(m[0]);
    }

    const result = val();
    ws();

    if (i !== src.length) {
        throw new Error('Unexpected trailing SNBT');
    }

    return result;
}

function plainText(x) {
    if (x == null) return '';

    if (typeof x === 'string') return x;

    if (typeof x === 'number' || typeof x === 'boolean') {
        return String(x);
    }

    if (Array.isArray(x)) {
        return x.map(plainText).join('');
    }

    let t = typeof x.text === 'string' ? x.text : '';

    if (!t && x.translate) {
        t = `[${x.translate}]`;
    }

    if (x.with && Array.isArray(x.with)) {
        t += ' ' + x.with.map(plainText).join(', ');
    }

    if (x.extra) {
        t += plainText(x.extra);
    }

    return t;
}

function toPlain(x) {
    if (typeof x !== 'string') {
        return plainText(x).replace(/§[0-9a-fk-or]/gi, '');
    }

    return x.replace(/§[0-9a-fk-or]/gi, '');
}

function getRankColor(level) {
    if (level >= 2) return COLORS.admin;
    if (level >= 1) return COLORS.trusted;
    return COLORS.public;
}

async function handleCommand(client, msg) {
    const args = msg.content
        .slice(global.commandPrefix.length)
        .trim()
        .split(/\s+/);

    const name = args.shift()?.toLowerCase();

    if (!name) return false;

    const bot = global.channelMap.get(msg.channel.id);
    const cmd = bot?.commands?.get(name);

    // Discord-only commands
    if (!cmd) {
        const dc = global.discordCommands.get(name);

        if (!dc) return false;

        try {
            const result = await dc.execute(msg, args, client, null);

            if (result instanceof EmbedBuilder) {
                await sendCommandOutput(msg, result);
            } else if (result?.embed) {
                await sendCommandOutput(msg, result.embed);
            } else if (typeof result === 'string') {
                await sendCommandOutput(msg, result);
            }
        } catch (e) {
            console.error(`[Discord] Command error (${name}):`, e);

            await sendCommandOutput(
                msg,
                'An error occurred while executing this command.',
                {
                    color: COLORS.error,
                    title: 'Command error'
                }
            );
        }

        return true;
    }

    const dconf = bot.globalConfig?.discord || {};

    // Resolve the actual Discord member.
    const member = msg.member ||
        await msg.guild.members.fetch(msg.author.id).catch(() => null);

    const roles = member?.roles?.cache;

    const hasRole = id => {
        if (!id || !roles) return false;
        return roles.has(String(id));
    };

    // ADMIN takes priority over TRUSTED.
    const level = hasRole(dconf.adminId)
        ? 2
        : hasRole(dconf.trustedId)
            ? 1
            : 0;

    const levels = {
        PUBLIC: 0,
        TRUSTED: 1,
        ADMIN: 2
    };

    const rankName = level === 2
        ? 'ADMIN'
        : level === 1
            ? 'TRUSTED'
            : 'PUBLIC';

    const rankColor = getRankColor(level);

    function resolveRequiredLevel(value) {
        if (typeof value === 'string') {
            const normalized = value.toUpperCase();

            if (Object.prototype.hasOwnProperty.call(levels, normalized)) {
                return levels[normalized];
            }
        }

        const number = Number(value);

        return Number.isFinite(number) ? number : 0;
    }

    const requiredLevel = resolveRequiredLevel(cmd.level);

    if (requiredLevel > level) {
        const requiredName = Object.entries(levels)
            .find(([, value]) => value === requiredLevel)?.[0] ||
            `LEVEL ${requiredLevel}`;

        await sendCommandOutput(
            msg,
            `Your rank: **${rankName}**\nRequired rank: **${requiredName}**`,
            {
                title: 'Permission denied',
                color: COLORS.error
            }
        );

        return true;
    }

    const username = bot.config.username;
    const uuid = bot.commands.getPlayerUUID(username);

    if (!uuid) {
        await sendCommandOutput(msg, 'Bot UUID unavailable.', {
            title: 'Command error',
            color: COLORS.error
        });

        return true;
    }

    const commands = new Map();

    for (const c of bot.commands.all()) {
        if (!c?.name) continue;

        commands.set(c.name.toLowerCase(), c);

        for (const alias of c.aliases || []) {
            if (typeof alias === 'string') {
                commands.set(alias.toLowerCase(), c);
            }
        }
    }

    const discordPlayer = {
        // Keep the Minecraft identity unchanged.
        name: username,
        uuid,

        // Discord user's permissions.
        level,
        rank: rankName,
        permissionLevel: level,
        permission: rankName.toLowerCase(),
        role: rankName.toLowerCase(),

        // Minecraft identity aliases.
        minecraftName: username,
        minecraftUUID: uuid,

        // Discord identity.
        discordId: msg.author.id,
        discordTag: msg.author.tag,
        discordUsername: msg.author.username,
        discordDisplayName: member?.displayName || msg.author.username
    };

    const send = text => {
        return sendCommandOutput(msg, String(text ?? ''), {
            title: 'Command response',
            color: rankColor,
            footer: `noratbot • ${rankName}`
        });
    };

    const ctx = {
        bot,
        bots: bot.manager?.bots || new Map(),

        player: discordPlayer,
        user: discordPlayer,
        member,

        discord: {
            id: msg.author.id,
            tag: msg.author.tag,
            username: msg.author.username,
            displayName: member?.displayName || msg.author.username,
            rank: rankName,
            level,
            permissionLevel: level,
            member
        },

        level,
        rank: rankName,
        levels,

        command: cmd,
        commandName: cmd.name || name,
        args,
        raw: [name, ...args].join(' '),

        message: msg,
        prefix: global.commandPrefix,
        source: 'discord',

        commands,
        commandsDir: path.join(process.cwd(), 'commands'),
        core: bot.core,

        run: async x => {
            const command = String(x);

            const match = /^\/?tellraw\s+\S+\s+([\s\S]+)$/i.exec(command);

            if (match) {
                let component;

                try {
                    component = JSON.parse(match[1]);
                } catch {
                    try {
                        component = parseSNBT(match[1]);
                    } catch {
                        component = match[1];
                    }
                }

                return send(toPlain(component));
            }

            return bot.core?.run(command);
        },

        tellraw: async (who, x) => send(toPlain(x)),
        tellrawCommand: async x => send(toPlain(x)),
        reply: async x => send(x)
    };

    try {
        const result = await cmd.execute(ctx);

        if (result instanceof EmbedBuilder) {
            await sendCommandOutput(msg, result, {
                color: rankColor
            });
        } else if (result?.embed) {
            await sendCommandOutput(msg, result.embed, {
                color: rankColor
            });
        } else if (typeof result === 'string' && result.trim()) {
            await send(result);
        }

    } catch (e) {
        console.error(`[${bot.id}] [Discord] Command error:`, e);

        await sendCommandOutput(
            msg,
            `An error occurred while executing this command.\n\`\`\`\n${String(e.message || e).slice(0, 1000)}\n\`\`\``,
            {
                title: 'Command error',
                color: COLORS.error
            }
        );
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
        partials: [
            Partials.Channel
        ]
    });

    global.discordClient = client;

    client.once('ready', () => {
        global.clientReady = true;
        loadCmds();

        console.log(`[Discord] Logged in as ${client.user.tag}`);
    });

    client.on('messageCreate', async msg => {
        if (msg.author.bot) return;
        if (!msg.guild) return;
        if (msg.channel.type !== ChannelType.GuildText) return;

        if (msg.content.startsWith(global.commandPrefix)) {
            if (await handleCommand(client, msg)) return;
        }

        const target = global.channelMap.get(msg.channel.id);

        if (!target) return;

        await handleMsg(target, msg);
    });

    client.on('error', e => {
        console.error('[Discord] Client error:', e);
    });

    client.on('shardDisconnect', () => {
        global.clientReady = false;
    });

    client.on('shardReady', () => {
        global.clientReady = true;
    });

    client.login(config.token).catch(e => {
        console.error('[Discord] Login error:', e);
    });
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

    if (!global.discordClient) {
        setupDC(dconf);
    }

    if (!global.channelMap.has(cid)) {
        global.channelMap.set(cid, bot);
    } else if (global.channelMap.get(cid) !== bot) {
        console.log(
            `[${bot.id}] [Discord] Log channel ${cid} already registered by another bot, skipping.`
        );

        return;
    }

    let buf = [];
    let timer = null;

    const INTERVAL = 900;
    const MAX_BUF = 50;
    const MAX_MESSAGE_LENGTH = 1900;

    async function flush() {
        if (!buf.length) return;

        const messages = buf.splice(0, buf.length);

        if (!global.clientReady) return;

        try {
            const ch = await global.discordClient.channels.fetch(cid);

            if (!ch) return;

            let combined = messages.join('\n');

            while (combined.length > 0) {
                let chunk = combined.slice(0, MAX_MESSAGE_LENGTH);

                if (combined.length > MAX_MESSAGE_LENGTH) {
                    const newline = chunk.lastIndexOf('\n');

                    if (newline > MAX_MESSAGE_LENGTH * 0.5) {
                        chunk = chunk.slice(0, newline);
                    }
                }

                await ch.send({
                    content: `\`\`\`\n${chunk}\n\`\`\``,
                    allowedMentions: {
                        parse: [],
                        repliedUser: false
                    }
                });

                combined = combined.slice(chunk.length).replace(/^\n+/, '');
            }

        } catch (e) {
            console.error(`[${bot.id}] [Discord] Chat send error:`, e);
        }
    }

    function addMsg(text) {
        if (!text || !String(text).trim()) return;

        const safeText = String(text).replaceAll('`', '\u200b`');

        if (buf.length >= MAX_BUF) {
            buf.shift();
        }

        if (buf.length > 0 && buf[buf.length - 1] === safeText) {
            return;
        }

        buf.push(safeText);

        if (!timer) {
            timer = setTimeout(async () => {
                timer = null;
                await flush();
            }, INTERVAL);
        }
    }

    const handlers = {
        onDisconnect() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }

            flush().finally(destroy);
        },

        onChatDisplay(message) {
            if (!message) return;
            addMsg(message);
        }
    };

    bot.on('bot:disconnect', handlers.onDisconnect);
    bot.on('chat_display', handlers.onChatDisplay);

    function destroy() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }

        buf = [];

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
