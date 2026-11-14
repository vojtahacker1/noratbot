'use strict';

const {
    Client,
    GatewayIntentBits,
    Partials,
    EmbedBuilder,
    ApplicationCommandOptionType,
    MessageFlags
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const CMD_DIR = path.join(process.cwd(), 'discordcommands');

const LEVELS = Object.freeze({ PUBLIC: 0, TRUSTED: 1, ADMIN: 2 });
const RANK_NAMES = Object.freeze(['PUBLIC', 'TRUSTED', 'ADMIN']);

const COLORS = Object.freeze({
    default: 0x5865F2,
    public: 0x5865F2,
    trusted: 0x57F287,
    admin: 0xF1C40F,
    success: 0x57F287,
    error: 0xED4245,
    warning: 0xFEE75C
});

const FOOTER = 'noratbot • Discord';
const COMMAND_PREFIX = '!';

const RELAY = Object.freeze({
    interval: 900,
    maxBuffer: 50,
    limit: 1900,
    maxRetries: 3
});

// Shared state. discordcommands/*.js read the global maps, so they stay
// authoritative instead of being copied into each command module.
if (!global.discordClient) global.discordClient = null;
if (!global.clientReady) global.clientReady = false;
if (!global.channelMap) global.channelMap = new Map();
if (!global.discordBots) global.discordBots = new Map();
if (!global.discordCommands) global.discordCommands = new Map();
if (!global.commandPrefix) global.commandPrefix = COMMAND_PREFIX;
if (!global.processedMessages) global.processedMessages = new Set();

const bridge = {
    client: null,
    config: null,
    prefix: COMMAND_PREFIX,
    relays: new Map(),
    slashRegistered: false,
    loginAttempts: 0,
    retryTimer: null
};

function log(...args) {
    console.log('[Discord]', ...args);
}

function warn(...args) {
    console.warn('[Discord]', ...args);
}

function fail(...args) {
    console.error('[Discord]', ...args);
}

function clampLevel(value) {
    return Math.min(LEVELS.ADMIN, Math.max(LEVELS.PUBLIC, value));
}

function truncate(value, limit) {
    const text = String(value ?? '');
    return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

function createEmbed(description, options = {}) {
    const embed = new EmbedBuilder()
        .setColor(options.color ?? COLORS.default)
        .setTimestamp();

    if (options.title) embed.setTitle(truncate(options.title, 256));
    if (description) embed.setDescription(truncate(description, 4096));
    if (options.footer) embed.setFooter({ text: truncate(options.footer, 2048) });

    return embed;
}

function splitText(text, limit = 3900) {
    const value = String(text ?? '');
    if (!value) return [];

    const chunks = [];
    let rest = value;

    while (rest.length > limit) {
        let cut = rest.lastIndexOf('\n', limit);

        if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit);
        if (cut < limit * 0.5) cut = limit;

        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut).replace(/^\n+/, '');
    }

    if (rest) chunks.push(rest);
    return chunks;
}

class Responder {
    constructor(target) {
        this.target = target;
        this.sent = false;
    }

    get isInteraction() {
        return typeof this.target?.isChatInputCommand === 'function';
    }

    async send(payload) {
        if (!this.target) return null;

        if (!this.isInteraction) return this.target.reply(payload);

        if (this.sent) return this.target.followUp(payload);

        this.sent = true;

        if (!this.target.deferred && !this.target.replied) {
            return this.target.reply(payload);
        }

        return this.target.editReply(payload);
    }
}

function mentionSafe() {
    return { parse: [], repliedUser: false };
}

async function sendEmbeds(responder, embeds) {
    if (!embeds.length) return;

    // Discord allows ten embeds per message.
    for (let i = 0; i < embeds.length; i += 10) {
        await responder.send({
            embeds: embeds.slice(i, i + 10),
            allowedMentions: mentionSafe()
        });
    }
}

async function sendOutput(target, output, options = {}) {
    if (output == null) return;

    const responder = target instanceof Responder ? target : new Responder(target);

    if (output instanceof EmbedBuilder) {
        return sendEmbeds(responder, [output]);
    }

    if (output?.embed instanceof EmbedBuilder) {
        return sendEmbeds(responder, [output.embed]);
    }

    if (Array.isArray(output)) {
        for (const item of output) await sendOutput(responder, item, options);
        return;
    }

    if (typeof output === 'object' && typeof output.description === 'string') {
        return sendEmbeds(responder, [
            createEmbed(output.description, {
                title: output.title,
                color: output.color ?? options.color,
                footer: output.footer ?? options.footer
            })
        ]);
    }

    const text = String(output);
    if (!text.trim()) return;

    const chunks = splitText(text);
    const embeds = chunks.map((chunk, index) =>
        createEmbed(chunk, {
            title: index === 0 ? options.title : undefined,
            color: options.color,
            footer: options.footer
        })
    );

    return sendEmbeds(responder, embeds);
}

function hasRole(member, id) {
    if (!id || !member) return false;

    const roles = member.roles;

    if (Array.isArray(roles)) return roles.includes(String(id));
    return Boolean(roles?.cache?.has(String(id)));
}

function rankOf(member, dconf) {
    if (hasRole(member, dconf?.adminId)) return 'ADMIN';
    if (hasRole(member, dconf?.trustedId)) return 'TRUSTED';
    return 'PUBLIC';
}

function levelOf(rank) {
    return LEVELS[rank] ?? LEVELS.PUBLIC;
}

function requiredLevel(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return clampLevel(Math.trunc(value));
    }

    const key = String(value ?? '').trim().toUpperCase();

    if (Object.prototype.hasOwnProperty.call(LEVELS, key)) return LEVELS[key];

    const numeric = Number(value);
    return Number.isFinite(numeric) ? clampLevel(Math.trunc(numeric)) : LEVELS.PUBLIC;
}

function rankName(level) {
    return RANK_NAMES[clampLevel(level)] || 'PUBLIC';
}

function rankColor(rank) {
    if (rank === 'ADMIN') return COLORS.admin;
    if (rank === 'TRUSTED') return COLORS.trusted;
    return COLORS.public;
}

function commandLevel(cmd) {
    return requiredLevel(cmd?.roleRequired);
}

async function sendPermissionDenied(responder, rank, required, ephemeral = false) {
    const embed = createEmbed(
        `Your rank: **${rank}**\nRequired rank: **${rankName(required)}**`,
        { title: 'Permission denied', color: COLORS.error }
    );

    if (ephemeral && responder?.isInteraction) {
        return responder.target.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    return responder.send({ embeds: [embed], allowedMentions: mentionSafe() });
}

function bots() {
    return [...new Set(global.discordBots.values())];
}

function getBot(id) {
    const key = String(id ?? '').trim().toLowerCase();
    if (!key) return null;

    return global.discordBots.get(key) ||
        bots().find(bot => String(bot.id).toLowerCase() === key) ||
        null;
}

function linkedBot(channelId) {
    return global.channelMap.get(String(channelId ?? '')) || null;
}

function defaultBot(channelId) {
    const linked = linkedBot(channelId);
    if (linked) return linked;

    const list = bots();
    return list.length === 1 ? list[0] : null;
}

function serverList() {
    return bots().map(bot => `\`${bot.id}\``).join(', ');
}

function waitForCore(bot, timeout = 5000) {
    if (typeof bot?.core?.run === 'function') return Promise.resolve(true);

    return new Promise(resolve => {
        const started = Date.now();
        const timer = setInterval(() => {
            if (typeof bot?.core?.run === 'function') {
                clearInterval(timer);
                resolve(true);
            } else if (Date.now() - started >= timeout) {
                clearInterval(timer);
                resolve(false);
            }
        }, 100);

        timer.unref?.();
    });
}

function runCore(bot, command) {
    if (typeof bot?.core?.run !== 'function') return false;

    try {
        return bot.core.run(command) !== false;
    } catch (error) {
        fail(`[${bot.id}] core command failed:`, error);
        return false;
    }
}

function toSNBT(obj) {
    if (obj == null) return "''";

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

    if (typeof obj === 'object') {
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

                if (src[i++] !== ':') throw new Error('Expected colon');

                o[k] = val();
                ws();

                if (src[i] === ',') {
                    i++;
                    ws();
                } else if (src[i] !== '}') {
                    throw new Error('Expected comma or closing brace');
                }
            }

            if (src[i++] !== '}') throw new Error('Unclosed compound');

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

            if (src[i++] !== ']') throw new Error('Unclosed array');

            return a;
        }

        if (c === "'" || c === '"') return str(c);

        const m = /^[^,\]}\s]+/.exec(src.slice(i));

        if (!m) throw new Error('Invalid SNBT value');

        i += m[0].length;

        if (m[0] === 'true') return true;
        if (m[0] === 'false') return false;

        return Number.isNaN(Number(m[0])) ? m[0] : Number(m[0]);
    }

    const result = val();
    ws();

    if (i !== src.length) throw new Error('Unexpected trailing SNBT');

    return result;
}

function plainText(component) {
    if (component == null) return '';

    if (typeof component === 'string') return component;
    if (typeof component === 'number' || typeof component === 'boolean') return String(component);
    if (Array.isArray(component)) return component.map(plainText).join('');

    let text = typeof component.text === 'string' ? component.text : '';

    if (!text && component.translate) text = `[${component.translate}]`;

    if (Array.isArray(component.with)) {
        text += ' ' + component.with.map(plainText).join(', ');
    }

    if (component.extra) text += plainText(component.extra);

    return text;
}

function toPlain(value) {
    return plainText(value).replace(/§[0-9a-fk-or]/gi, '');
}

function loadCommands() {
    global.discordCommands.clear();

    if (!fs.existsSync(CMD_DIR)) {
        fs.mkdirSync(CMD_DIR, { recursive: true });
        return;
    }

    const files = fs.readdirSync(CMD_DIR).filter(file => file.endsWith('.js')).sort();

    for (const file of files) {
        const fullPath = path.join(CMD_DIR, file);

        try {
            delete require.cache[require.resolve(fullPath)];
            const cmd = require(fullPath);

            if (!cmd || typeof cmd.execute !== 'function') {
                warn(`Skipping ${file}: no execute() export`);
                continue;
            }

            const name = String(cmd.name || path.basename(file, '.js')).toLowerCase().trim();
            if (!name) {
                warn(`Skipping ${file}: empty command name`);
                continue;
            }

            cmd.name = name;
            registerCommand(name, cmd);

            for (const alias of cmd.aliases || []) {
                const key = String(alias).toLowerCase().trim();
                if (key) registerCommand(key, cmd);
            }
        } catch (error) {
            fail(`Failed to load ${file}:`, error);
        }
    }
}

function registerCommand(name, cmd) {
    const existing = global.discordCommands.get(name);

    if (existing && existing !== cmd) {
        warn(`Duplicate Discord command "${name}" (${existing.name} vs ${cmd.name}); keeping the first`);
        return;
    }

    global.discordCommands.set(name, cmd);
}

function normalizeSlashOptions(cmd) {
    if (cmd.slash === false) return null;

    if (Array.isArray(cmd.slash?.options)) {
        return cmd.slash.options;
    }

    return [
        {
            type: ApplicationCommandOptionType.String,
            name: 'input',
            description: 'Arguments, using the same syntax as the prefix command',
            required: false
        }
    ];
}

function buildSlashCommands() {
    const definitions = [];
    const seen = new Set();

    for (const cmd of global.discordCommands.values()) {
        if (seen.has(cmd.name)) continue;

        const options = normalizeSlashOptions(cmd);
        if (options === null) continue;

        const name = cmd.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 32);
        if (!name) continue;

        seen.add(name);
        definitions.push({
            name,
            description: truncate(cmd.description || 'No description', 100),
            options
        });
    }

    if (!seen.has('mc')) {
        definitions.push({
            name: 'mc',
            description: 'Run a bot command on a Minecraft server',
            options: [
                {
                    type: ApplicationCommandOptionType.String,
                    name: 'command',
                    description: 'Command without the bot prefix',
                    required: true
                },
                {
                    type: ApplicationCommandOptionType.String,
                    name: 'server',
                    description: 'Server id (defaults to the linked server)',
                    required: false
                }
            ]
        });
    }

    return definitions;
}

async function registerSlashCommands() {
    const config = bridge.config;
    const client = bridge.client;

    if (!client?.application) return;
    if (config.slashCommands === false) {
        log('Slash commands disabled in config');
        return;
    }
    if (bridge.slashRegistered) return;

    const definitions = buildSlashCommands();
    if (!definitions.length) return;

    try {
        if (config.guildId) {
            await client.application.commands.set(definitions, String(config.guildId));
        } else {
            await client.application.commands.set(definitions);
        }

        bridge.slashRegistered = true;
        log(`Registered ${definitions.length} slash command(s)${config.guildId ? ' in guild ' + config.guildId : ''}`);
    } catch (error) {
        fail('Failed to register slash commands:', error);
    }
}

function displayName(member, user) {
    return String(
        member?.displayName ||
        user?.globalName ||
        user?.username ||
        'unknown'
    ).replace(/§/g, '').slice(0, 80);
}

function formatMentions(message) {
    let text = message.content || '';

    for (const [id, role] of message.mentions?.roles ?? []) {
        text = text.split(`<@&${id}>`).join(`@${role.name || 'role'}`);
    }

    for (const [id, channel] of message.mentions?.channels ?? []) {
        text = text.split(`<#${id}>`).join(`#${channel.name || 'channel'}`);
    }

    for (const [id, user] of message.mentions?.users ?? []) {
        const name = message.mentions.members?.get(id)?.displayName ||
            user.globalName ||
            user.username ||
            'user';

        text = text
            .split(`<@${id}>`).join(`@${name}`)
            .split(`<@!${id}>`).join(`@${name}`);
    }

    return text.replace(/<a?:([A-Za-z0-9_~]+):\d+>/g, ':$1:');
}

function stripMarkdown(text) {
    return String(text ?? '')
        .replace(/```([\s\S]*?)```/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/~~(.+?)~~/g, '$1')
        .replace(/\|\|(.+?)\|\|/g, '$1')
        .replace(/^\s*>\s?/gm, '')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function describeMessage(message) {
    const parts = [];
    const text = stripMarkdown(formatMentions(message)).trim();

    if (text) parts.push(text);

    for (const attachment of message.attachments?.values?.() ?? []) {
        const type = String(attachment.contentType || '');
        const kind = type.startsWith('image/')
            ? 'image'
            : type.startsWith('video/')
                ? 'video'
                : type.startsWith('audio/')
                    ? 'audio'
                    : 'file';

        parts.push(`[${kind}: ${attachment.name || 'attachment'}] ${attachment.url}`);
    }

    for (const sticker of message.stickers?.values?.() ?? []) {
        parts.push(`[sticker: ${sticker.name || 'sticker'}]`);
    }

    for (const embed of message.embeds ?? []) {
        const label = embed.title || embed.description || embed.url || 'embed';
        parts.push(`[embed: ${stripMarkdown(label).slice(0, 200)}]`);
    }

    return parts.join('\n');
}

async function repliedTo(message) {
    const id = message.reference?.messageId;
    if (!id) return '';

    const channel = message.channel;
    let target = channel.messages?.cache?.get?.(id);

    if (!target) {
        target = await channel.messages?.fetch?.(id).catch(() => null);
    }

    if (!target || target.author?.bot) return '';

    return displayName(target.member, target.author);
}

function relayFor(bot) {
    return bridge.relays.get(String(bot.id).toLowerCase()) || null;
}

function noteEcho(bot, text) {
    const relay = relayFor(bot);
    if (!relay) return;

    relay.echoes.set(text, Date.now());

    if (relay.echoes.size > 25) {
        const now = Date.now();

        for (const [key, timestamp] of relay.echoes) {
            if (now - timestamp > 15000) relay.echoes.delete(key);
        }

        if (relay.echoes.size > 50) {
            relay.echoes.delete(relay.echoes.keys().next().value);
        }
    }
}

function consumeEcho(relay, text) {
    const now = Date.now();

    for (const [key, timestamp] of relay.echoes) {
        if (now - timestamp > 15000) {
            relay.echoes.delete(key);
            continue;
        }

        if (text === key || text.endsWith(key)) {
            relay.echoes.delete(key);
            return true;
        }
    }

    return false;
}

async function relayDiscordMessage(bot, message) {
    if (global.processedMessages.has(message.id)) return;

    global.processedMessages.add(message.id);
    if (global.processedMessages.size > 1000) {
        global.processedMessages.delete(global.processedMessages.values().next().value);
    }

    if (!await waitForCore(bot)) {
        warn(`[${bot.id}] core not ready, dropping Discord message relay`);
        return;
    }

    const author = displayName(message.member, message.author);
    const replyTarget = await repliedTo(message);
    const body = describeMessage(message);

    if (!body && !replyTarget) return;

    let suffix = replyTarget ? ` (reply to @${replyTarget}): ${body}` : `: ${body}`;
    if (suffix.length > 500) suffix = suffix.slice(0, 497) + '...';

    const visible = `[noratbot Discord] ${author}${suffix}`;
    noteEcho(bot, visible);

    const link = bot.globalConfig?.discord?.link || 'https://discord.gg';

    const extra = [
        {
            text: '[noratbot Discord] ',
            color: '#55aaff',
            click_event: { action: 'copy_to_clipboard', value: link },
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
            click_event: { action: 'copy_to_clipboard', value: author },
            hover_event: {
                action: 'show_text',
                value: {
                    text:
                        'Discord User\n\n' +
                        `Tag: ${message.author?.tag || message.author?.username || 'unknown'}\n` +
                        `ID: ${message.author?.id || 'unknown'}` +
                        (replyTarget ? `\nReplying to: ${replyTarget}` : ''),
                    color: 'green'
                }
            }
        },
        {
            text: suffix,
            color: '#d4d4d4',
            click_event: {
                action: 'copy_to_clipboard',
                value: (replyTarget ? `(reply to @${replyTarget}) ` : '') + body.slice(0, 1000)
            },
            hover_event: {
                action: 'show_text',
                value: {
                    text: `Message\n${body.length} chars\n\nClick to copy`,
                    color: 'gray'
                }
            }
        }
    ];

    runCore(bot, `tellraw @a ${toSNBT({ text: '', extra })}`);
}

function protectFences(text) {
    // Keep user text from closing the surrounding Discord code block.
    return String(text).replace(/```/g, '`\u200b`\u200b`');
}

function takeBatch(lines) {
    let content = '';
    let consumed = 0;

    for (const line of lines) {
        const next = content ? `${content}\n${line}` : line;

        if (next.length > RELAY.limit) break;

        content = next;
        consumed++;
    }

    return { content, consumed };
}

function attachRelay(bot, channelId) {
    const key = String(bot.id).toLowerCase();

    if (bridge.relays.has(key)) return;

    const relay = {
        bot,
        channelId: String(channelId),
        buffer: [],
        timer: null,
        flushing: false,
        retries: 0,
        echoes: new Map(),
        stopped: false
    };

    relay.schedule = (delay = RELAY.interval) => {
        if (relay.timer || relay.stopped) return;

        relay.timer = setTimeout(() => {
            relay.timer = null;
            void relay.flush();
        }, delay);

        relay.timer.unref?.();
    };

    relay.enqueue = text => {
        const value = protectFences(String(text ?? '').replace(/\u0000/g, ''));
        if (!value.trim()) return;

        for (const chunk of splitText(value, RELAY.limit)) {
            relay.buffer.push(chunk);
        }

        while (relay.buffer.length > RELAY.maxBuffer) relay.buffer.shift();

        relay.schedule();
    };

    relay.flush = async () => {
        if (relay.flushing || !relay.buffer.length || relay.stopped) return;
        if (!bridge.client?.isReady()) return;

        relay.flushing = true;

        const channel = await fetchTextChannel(relay.channelId);

        if (!channel) {
            relay.flushing = false;
            relay.retries++;

            if (relay.retries > RELAY.maxRetries) {
                fail(`[${bot.id}] chat relay channel ${relay.channelId} is unavailable; dropping ${relay.buffer.length} message(s)`);
                relay.buffer.length = 0;
                relay.retries = 0;
            } else {
                relay.schedule(5000 * relay.retries);
            }

            return;
        }

        try {
            while (relay.buffer.length) {
                const { content, consumed } = takeBatch(relay.buffer);
                if (!content || !consumed) break;

                await channel.send({
                    content: `\`\`\`\n${content}\n\`\`\``,
                    allowedMentions: mentionSafe()
                });

                relay.buffer.splice(0, consumed);
            }

            relay.retries = 0;
            relay.flushing = false;

            if (relay.buffer.length) relay.schedule();
        } catch (error) {
            relay.flushing = false;
            relay.retries++;

            if (relay.retries > RELAY.maxRetries) {
                fail(`[${bot.id}] chat relay failed ${relay.retries} time(s); dropping ${relay.buffer.length} message(s):`, error.message);
                relay.buffer.length = 0;
                relay.retries = 0;
            } else {
                warn(`[${bot.id}] chat relay send failed (attempt ${relay.retries}), retrying:`, error.message);
                relay.schedule(2000 * relay.retries);
            }
        }
    };

    const onChat = text => {
        if (consumeEcho(relay, text)) return;
        relay.enqueue(text);
    };

    const onDisconnect = () => {
        void relay.flush();
    };

    const onDestroy = () => {
        if (relay.stopped) return;

        // One last send so chat that arrived before shutdown is not lost.
        void relay.flush().finally(() => relay.destroy());
    };

    relay.destroy = () => {
        if (relay.stopped) return;

        relay.stopped = true;

        if (relay.timer) {
            clearTimeout(relay.timer);
            relay.timer = null;
        }

        bot.removeListener('chat_display', onChat);
        bot.removeListener('bot:disconnect', onDisconnect);
        bot.removeListener('bot:destroy', onDestroy);

        bridge.relays.delete(key);

        for (const [id, linked] of global.channelMap) {
            if (linked === bot) global.channelMap.delete(id);
        }
    };

    bot.on('chat_display', onChat);
    bot.on('bot:disconnect', onDisconnect);
    bot.once('bot:destroy', onDestroy);

    bridge.relays.set(key, relay);
}

async function fetchTextChannel(id) {
    const client = bridge.client;
    if (!client?.isReady()) return null;

    try {
        const channel = client.channels.cache.get(String(id)) ||
            await client.channels.fetch(String(id));

        if (!channel?.isTextBased()) return null;
        return channel;
    } catch {
        return null;
    }
}

function flushRelays() {
    for (const relay of bridge.relays.values()) {
        void relay.flush();
    }
}

function registerBot(bot) {
    const id = String(bot.id ?? '').toLowerCase();
    if (!id) return;

    global.discordBots.set(id, bot);

    const channelId = String(bot.config?.channelId ?? '').trim();
    if (!channelId) {
        log(`[${bot.id}] no channelId configured; commands only`);
        return;
    }

    const existing = global.channelMap.get(channelId);

    if (existing && existing !== bot) {
        warn(`[${bot.id}] channel ${channelId} is already bridged to ${existing.id}; relay disabled for this bot`);
        return;
    }

    global.channelMap.set(channelId, bot);
    attachRelay(bot, channelId);
}

function buildDiscordContext(cmd, invocation) {
    const color = rankColor(invocation.rank);

    const reply = (text, options = {}) => sendOutput(invocation.responder, text, {
        title: options.title ?? 'Command response',
        color: options.color ?? color,
        footer: options.footer ?? `${FOOTER} • ${invocation.rank}`
    });

    return {
        source: invocation.source,
        command: cmd,
        commandName: cmd.name,
        args: invocation.args,
        raw: invocation.raw,
        message: invocation.message,
        interaction: invocation.interaction,
        member: invocation.member,
        user: invocation.user,
        guild: invocation.guild,
        channel: invocation.channel,
        client: bridge.client,
        bot: invocation.bot,
        bots: bots(),
        level: invocation.level,
        rank: invocation.rank,
        levels: LEVELS,
        config: bridge.config,
        botById: getBot,
        reply,
        embed: (embed, options = {}) => sendOutput(invocation.responder, embed, options),
        run: command => runCore(invocation.bot, command)
    };
}

async function runDiscordCommand(cmd, invocation) {
    const required = commandLevel(cmd);

    if (invocation.level < required) {
        return sendPermissionDenied(
            invocation.responder,
            invocation.rank,
            required,
            invocation.source === 'slash'
        );
    }

    const ctx = buildDiscordContext(cmd, invocation);

    try {
        const result = await cmd.execute(
            invocation.message,
            invocation.args,
            bridge.client,
            invocation.bot,
            ctx
        );

        await sendOutput(invocation.responder, result, {
            title: 'Command response',
            color: rankColor(invocation.rank),
            footer: `${FOOTER} • ${invocation.rank}`
        });
    } catch (error) {
        fail(`Command "${cmd.name}" failed:`, error);

        await sendOutput(
            invocation.responder,
            `An error occurred while running this command.\n\`\`\`\n${truncate(error?.message || error, 1000)}\n\`\`\``,
            { title: 'Command error', color: COLORS.error }
        );
    }
}

function buildMinecraftContext(cmd, invocation) {
    const bot = invocation.bot;
    const username = bot?.config?.username || bot?.client?.username || 'bot';
    const uuid = bot?.commands?.getPlayerUUID?.(username) || null;

    const send = (text, options = {}) => sendOutput(invocation.responder, String(text ?? ''), {
        title: options.title ?? `${cmd.name} • ${bot?.id || 'noratbot'}`,
        color: options.color ?? rankColor(invocation.rank),
        footer: options.footer ?? `${FOOTER} • ${invocation.rank}`
    });

    const player = {
        name: username,
        username,
        uuid,
        minecraftName: username,
        minecraftUUID: uuid,
        level: invocation.level,
        rank: invocation.rank,
        permissionLevel: invocation.level,
        permission: invocation.rank.toLowerCase(),
        discordId: invocation.user?.id,
        discordTag: invocation.user?.tag,
        discordUsername: invocation.user?.username,
        discordDisplayName: displayName(invocation.member, invocation.user)
    };

    const commands = new Map();

    for (const entry of bot?.commands?.all?.() || []) {
        if (!entry?.name) continue;

        commands.set(entry.name.toLowerCase(), entry);

        for (const alias of entry.aliases || []) {
            if (typeof alias === 'string') commands.set(alias.toLowerCase(), entry);
        }
    }

    return {
        bot,
        bots: bot?.manager?.bots || new Map(),
        player,
        user: player,
        member: invocation.member,

        discord: {
            id: invocation.user?.id,
            tag: invocation.user?.tag,
            username: invocation.user?.username,
            displayName: displayName(invocation.member, invocation.user),
            rank: invocation.rank,
            level: invocation.level,
            permissionLevel: invocation.level,
            member: invocation.member
        },

        level: invocation.level,
        rank: invocation.rank,
        levels: LEVELS,

        command: cmd,
        commandName: cmd.name,
        args: invocation.args,
        raw: invocation.raw,

        message: invocation.message,
        interaction: invocation.interaction,
        source: invocation.source,
        prefix: bridge.prefix,

        commands,
        commandsDir: path.join(process.cwd(), 'commands'),
        core: bot?.core,

        run: command => {
            const text = String(command);

            const match = /^\/?tellraw\s+\S+\s+([\s\S]+)$/i.exec(text);

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

                send(toPlain(component));
                return true;
            }

            return runCore(bot, text);
        },

        tellraw: (who, value) => {
            send(toPlain(value));
            return true;
        },

        tellrawCommand: value => {
            send(toPlain(value));
            return true;
        },

        reply: value => {
            send(value);
            return true;
        }
    };
}

async function runMinecraftCommand(cmd, bot, args, invocation) {
    const required = requiredLevel(cmd.level);

    if (invocation.level < required) {
        return sendPermissionDenied(
            invocation.responder,
            invocation.rank,
            required,
            invocation.source === 'slash'
        );
    }

    const ctx = buildMinecraftContext(cmd, { ...invocation, bot, args });

    try {
        const result = await cmd.execute(ctx);

        if (result == null) return;

        await sendOutput(invocation.responder, result, {
            title: 'Command response',
            color: rankColor(invocation.rank),
            footer: `${FOOTER} • ${invocation.rank}`
        });
    } catch (error) {
        fail(`Minecraft command "${cmd.name}" on ${bot.id} failed:`, error);

        await sendOutput(
            invocation.responder,
            `Could not run \`${cmd.name}\` on **${bot.id}**.\n\`\`\`\n${truncate(error?.message || error, 1000)}\n\`\`\``,
            { title: 'Command error', color: COLORS.error }
        );
    }
}

async function runMinecraftCommandByName(bot, words, invocation) {
    const name = String(words[0] ?? '').replace(/^[!/]/, '').toLowerCase();
    const args = words.slice(1);

    if (!name) {
        return sendOutput(invocation.responder, 'Usage: `mc <command>` or `mc <server> <command>`.', {
            title: 'Minecraft command',
            color: COLORS.error
        });
    }

    const cmd = bot?.commands?.get?.(name);

    if (!cmd) {
        return sendOutput(
            invocation.responder,
            `Unknown command \`${name}\` on **${bot.id}**.`,
            { title: 'Minecraft command', color: COLORS.error }
        );
    }

    return runMinecraftCommand(cmd, bot, args, invocation);
}

function parseInputWords(value) {
    const text = String(value ?? '').trim();
    return text ? text.split(/\s+/) : [];
}

function commandsChannelId() {
    return String(
        bridge.config?.commandsChannelId ||
        bridge.config?.messagesId ||
        ''
    ).trim();
}

async function handlePrefixCommand(message, name, args) {
    const config = bridge.config;
    const rank = rankOf(message.member, config);
    const responder = new Responder(message);
    const invocation = {
        source: 'prefix',
        message,
        interaction: null,
        member: message.member,
        user: message.author,
        guild: message.guild,
        channel: message.channel,
        args,
        raw: [name, ...args].join(' '),
        rank,
        level: levelOf(rank),
        responder,
        bot: defaultBot(message.channel.id)
    };

    const discordCommand = global.discordCommands.get(name);

    if (discordCommand) {
        await runDiscordCommand(discordCommand, invocation);
        return true;
    }

    if (name === 'mc' || name === 'minecraft') {
        let target = invocation.bot;
        let words = [...args];

        if (words.length > 1) {
            const explicit = getBot(words[0]);

            if (explicit) {
                target = explicit;
                words = words.slice(1);
            }
        }

        if (!target) {
            await sendOutput(responder, `Choose a server: ${serverList() || 'none registered'}.`, {
                title: 'Minecraft command',
                color: COLORS.error
            });
            return true;
        }

        await runMinecraftCommandByName(target, words, { ...invocation, bot: target });
        return true;
    }

    // In-game commands are reachable from the channel bridged to a bot or
    // from the dedicated commands channel. Elsewhere `mc` is the explicit path.
    const linked = linkedBot(message.channel.id);
    const dedicated = commandsChannelId();
    const inCommandsChannel = Boolean(dedicated) && String(message.channel.id) === dedicated;

    if (linked || inCommandsChannel) {
        let target = linked;
        let cmdArgs = args;

        if (!target) {
            const explicit = args.length > 1 ? getBot(args[0]) : null;
            const list = bots();

            if (explicit) {
                target = explicit;
                cmdArgs = args.slice(1);
            } else if (list.length === 1) {
                target = list[0];
            } else {
                await sendOutput(
                    responder,
                    `Choose a server: ${serverList() || 'none registered'}.`,
                    { title: 'Minecraft command', color: COLORS.error }
                );
                return true;
            }
        }

        const cmd = target?.commands?.get?.(name);

        if (cmd) {
            await runMinecraftCommand(cmd, target, cmdArgs, { ...invocation, bot: target });
            return true;
        }

        if (inCommandsChannel) {
            await sendOutput(responder, `Unknown command \`${name}\`. Try \`${bridge.prefix}help\`.`, {
                title: 'Command error',
                color: COLORS.error
            });
            return true;
        }
    }

    return false;
}

async function handleMessage(message) {
    if (!message.inGuild?.() || message.author?.bot || message.system) return;

    const channel = message.channel;
    if (!channel?.isTextBased?.() || channel.isDMBased?.()) return;

    const content = message.content || '';

    if (content.startsWith(bridge.prefix) && content.length > bridge.prefix.length) {
        const raw = content.slice(bridge.prefix.length).trim();
        const [name, ...args] = raw.split(/\s+/);

        if (name) {
            const handled = await handlePrefixCommand(message, name.toLowerCase(), args);
            if (handled) return;
        }
    }

    const bot = linkedBot(channel.id);
    if (!bot) return;

    await relayDiscordMessage(bot, message);
}

async function handleInteraction(interaction) {
    if (!interaction.inGuild?.()) {
        await interaction.reply({
            content: 'This bot only accepts commands inside a server.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return;
    }

    const config = bridge.config;
    const rank = rankOf(interaction.member, config);
    const name = interaction.commandName;
    const responder = new Responder(interaction);

    const invocation = {
        source: 'slash',
        message: interaction,
        interaction,
        member: interaction.member,
        user: interaction.user,
        guild: interaction.guild,
        channel: interaction.channel,
        args: [],
        raw: '',
        rank,
        level: levelOf(rank),
        responder,
        bot: defaultBot(interaction.channelId)
    };

    try {
        if (name === 'mc') {
            const command = interaction.options.getString('command', true);
            const server = interaction.options.getString('server');
            const target = server ? getBot(server) : invocation.bot;

            if (!target) {
                await interaction.reply({
                    embeds: [
                        createEmbed(`Choose a server: ${serverList() || 'none registered'}.`, {
                            title: 'Minecraft command',
                            color: COLORS.error
                        })
                    ],
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            await interaction.deferReply();

            invocation.bot = target;
            invocation.args = parseInputWords(command);
            invocation.raw = command;

            await runMinecraftCommandByName(target, invocation.args, invocation);
            return;
        }

        const cmd = global.discordCommands.get(name);

        if (!cmd) {
            await interaction.reply({
                embeds: [createEmbed('Unknown command.', { title: 'Command error', color: COLORS.error })],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const required = commandLevel(cmd);

        if (invocation.level < required) {
            await sendPermissionDenied(responder, rank, required, true);
            return;
        }

        await interaction.deferReply();

        const input = interaction.options.getString('input') ?? '';
        invocation.args = parseInputWords(input);
        invocation.raw = input;

        await runDiscordCommand(cmd, invocation);
    } catch (error) {
        fail(`Interaction "${name}" failed:`, error);

        const payload = {
            embeds: [
                createEmbed('An error occurred while running this command.', {
                    title: 'Command error',
                    color: COLORS.error
                })
            ],
            allowedMentions: mentionSafe()
        };

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp(payload);
            } else {
                await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
            }
        } catch {
            // Interaction may have expired.
        }
    }
}

function bindClient(client) {
    client.once('ready', () => {
        bridge.ready = true;
        bridge.disabled = false;
        bridge.loginAttempts = 0;
        global.clientReady = true;
        log(`Logged in as ${client.user.tag}`);

        loadCommands();
        void registerSlashCommands();
        flushRelays();
    });

    client.on('messageCreate', message => {
        handleMessage(message).catch(error => fail('message handler failed:', error));
    });

    client.on('interactionCreate', interaction => {
        if (!interaction.isChatInputCommand?.()) return;

        handleInteraction(interaction).catch(error => fail('interaction handler failed:', error));
    });

    client.on('shardReady', id => {
        global.clientReady = true;
        log(`Shard ${id} ready`);
        flushRelays();
    });

    client.on('shardDisconnect', (event, id) => {
        global.clientReady = false;
        warn(`Shard ${id} disconnected (code ${event?.code ?? 'unknown'})`);
    });

    client.on('shardError', (error, id) => {
        fail(`Shard ${id} error:`, error);
    });

    client.on('invalidated', () => {
        fail('Session invalidated; reconnecting in 10s');
        bridge.ready = false;
        global.clientReady = false;
        global.discordClient = null;
        bridge.client = null;

        try {
            client.destroy();
        } catch {
            // Already gone.
        }

        scheduleClientRetry(new Error('session invalidated'));
    });

    client.on('error', error => fail('Client error:', error));
    client.on('warn', message => warn(message));
}

function scheduleClientRetry(error) {
    if (bridge.retryTimer) return;

    if (error?.code === 'TokenInvalid' || /invalid token/i.test(error?.message || '')) {
        bridge.disabled = true;
        fail('Discord token is invalid; fix discord.token and restart.');
        return;
    }

    bridge.loginAttempts++;

    if (bridge.loginAttempts > 5) {
        fail('Giving up on Discord after 5 failed login attempts.');
        return;
    }

    const delay = Math.min(30000, 5000 * bridge.loginAttempts);

    warn(`Retrying Discord login in ${delay}ms (attempt ${bridge.loginAttempts})`);

    bridge.retryTimer = setTimeout(() => {
        bridge.retryTimer = null;
        ensureClient();
    }, delay);

    bridge.retryTimer.unref?.();
}

function ensureClient() {
    if (bridge.disabled) return null;
    if (bridge.client && !bridge.client.destroyed) return bridge.client;

    bridge.client = null;

    const config = bridge.config;

    if (!config?.token) {
        bridge.disabled = true;
        fail('No bot token configured (discord.token); Discord integration is disabled.');
        return null;
    }

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ],
        partials: [Partials.Channel],
        allowedMentions: mentionSafe()
    });

    bridge.client = client;
    global.discordClient = client;

    bindClient(client);

    client.login(config.token).catch(error => {
        fail('Login failed:', error.message);
        global.discordClient = null;
        bridge.client = null;

        try {
            client.destroy();
        } catch {
            // Already gone.
        }

        scheduleClientRetry(error);
    });

    return client;
}

function setup(bot) {
    const config = bot.globalConfig?.discord;

    if (!config?.enabled) return false;

    if (!bridge.config) {
        bridge.config = config;
        bridge.prefix = String(config.commandPrefix || COMMAND_PREFIX);
        global.commandPrefix = bridge.prefix;
    }

    return true;
}

module.exports = function discordBridge(bot) {
    if (!setup(bot)) return;
    if (!ensureClient()) return;

    registerBot(bot);

    log(`Bridge active for "${bot.id}"${bot.config?.channelId ? ` (channel ${bot.config.channelId})` : ''}`);
};

// Exposed for tests and tooling; not part of the bot API.
module.exports._internal = {
    LEVELS,
    requiredLevel,
    rankOf,
    splitText,
    stripMarkdown,
    formatMentions,
    toSNBT,
    parseSNBT,
    takeBatch,
    protectFences
};
